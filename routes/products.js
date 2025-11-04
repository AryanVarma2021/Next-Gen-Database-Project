const express = require('express');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const Product = require('../models/Product');
const redisService = require('../services/redisService');
const neo4jService = require('../services/neo4jService');

const router = express.Router();

// @desc    Get all products with filtering, sorting, and pagination
// @route   GET /api/products
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = { isActive: true };
    
    if (req.query.category) {
      filter.category = req.query.category;
    }
    
    if (req.query.brand) {
      filter.brand = new RegExp(req.query.brand, 'i');
    }
    
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = parseFloat(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = parseFloat(req.query.maxPrice);
    }
    
    if (req.query.search) {
      filter.$text = { $search: req.query.search };
    }

    // Build sort object
    let sort = { createdAt: -1 };
    if (req.query.sort) {
      switch (req.query.sort) {
        case 'price_asc':
          sort = { price: 1 };
          break;
        case 'price_desc':
          sort = { price: -1 };
          break;
        case 'rating':
          sort = { 'rating.average': -1 };
          break;
        case 'name':
          sort = { name: 1 };
          break;
        default:
          sort = { createdAt: -1 };
      }
    }

    // Check cache first
    const cacheKey = `products:${JSON.stringify({ filter, sort, page, limit })}`;
    let cachedProducts = await redisService.get(cacheKey);
    
    if (cachedProducts) {
      return res.status(200).json({
        success: true,
        count: cachedProducts.length,
        pagination: {
          page,
          limit,
          total: cachedProducts.totalCount
        },
        data: cachedProducts
      });
    }

    // Get products from database
    const products = await Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('reviews.user', 'name');

    const totalCount = await Product.countDocuments(filter);

    // Cache the results
    await redisService.set(cacheKey, { ...products, totalCount }, 600); // 10 minutes

    // Track user interaction if authenticated
    if (req.user && req.query.search) {
      try {
        await neo4jService.createUserInteraction(
          req.user._id.toString(),
          'search',
          'SEARCHED',
          Date.now()
        );
      } catch (neo4jError) {
        console.error('Neo4j search tracking error:', neo4jError);
      }
    }

    res.status(200).json({
      success: true,
      count: products.length,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      },
      data: products
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    // Check cache first
    let product = await redisService.getCachedProduct(req.params.id);
    
    if (!product) {
      product = await Product.findById(req.params.id)
        .populate('reviews.user', 'name avatar');
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      // Cache the product
      await redisService.cacheProduct(req.params.id, product);
    }

    // Track user view if authenticated
    if (req.user) {
      try {
        await neo4jService.createUserInteraction(
          req.user._id.toString(),
          req.params.id,
          'VIEWED',
          Date.now()
        );
      } catch (neo4jError) {
        console.error('Neo4j view tracking error:', neo4jError);
      }
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get product recommendations
// @route   GET /api/products/:id/recommendations
// @access  Public
router.get('/:id/recommendations', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    // Get recommendations from Neo4j
    const recommendations = await neo4jService.getProductRecommendations(req.params.id, limit);
    
    if (recommendations.length === 0) {
      // Fallback: get products from same category
      const product = await Product.findById(req.params.id);
      if (product) {
        const fallbackProducts = await Product.find({
          category: product.category,
          _id: { $ne: req.params.id },
          isActive: true
        })
        .limit(limit)
        .sort({ 'rating.average': -1 });
        
        return res.status(200).json({
          success: true,
          data: fallbackProducts
        });
      }
    }

    // Get full product details for recommendations
    const productIds = recommendations.map(rec => rec.properties.id);
    const recommendedProducts = await Product.find({
      _id: { $in: productIds },
      isActive: true
    });

    res.status(200).json({
      success: true,
      data: recommendedProducts
    });
  } catch (error) {
    console.error('Get recommendations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create new product
// @route   POST /api/products
// @access  Private/Admin
router.post('/', protect, authorize('admin'), async (req, res) => {
  try {
    const product = await Product.create(req.body);

    // Create product in Neo4j
    try {
      await neo4jService.createProduct(product._id.toString(), {
        name: product.name,
        category: product.category,
        brand: product.brand,
        price: product.price,
        rating: product.rating.average
      });
    } catch (neo4jError) {
      console.error('Neo4j product creation error:', neo4jError);
    }

    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private/Admin
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Update cache
    await redisService.cacheProduct(req.params.id, product);

    // Update Neo4j
    try {
      await neo4jService.createProduct(product._id.toString(), {
        name: product.name,
        category: product.category,
        brand: product.brand,
        price: product.price,
        rating: product.rating.average
      });
    } catch (neo4jError) {
      console.error('Neo4j product update error:', neo4jError);
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Clear cache
    await redisService.invalidateProductCache(req.params.id);

    // Delete from Neo4j
    try {
      await neo4jService.deleteProduct(req.params.id);
    } catch (neo4jError) {
      console.error('Neo4j product deletion error:', neo4jError);
    }

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add product review
// @route   POST /api/products/:id/reviews
// @access  Private
router.post('/:id/reviews', protect, async (req, res) => {
  try {
    const { rating, comment } = req.body;

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if user already reviewed this product
    const existingReview = product.reviews.find(
      review => review.user.toString() === req.user._id.toString()
    );

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this product'
      });
    }

    // Add review
    product.reviews.push({
      user: req.user._id,
      rating,
      comment
    });

    // Update rating
    product.updateRating();
    await product.save();

    // Clear cache
    await redisService.invalidateProductCache(req.params.id);

    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      data: product
    });
  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

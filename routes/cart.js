const express = require('express');
const { protect } = require('../middleware/auth');
const Product = require('../models/Product');
const redisService = require('../services/redisService');

const router = express.Router();

// @desc    Get user's cart
// @route   GET /api/cart
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const cart = await redisService.getCart(req.user._id.toString());
    
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          items: [],
          total: 0,
          itemCount: 0
        }
      });
    }

    // Get full product details for cart items
    const productIds = cart.items.map(item => item.product);
    const products = await Product.find({
      _id: { $in: productIds },
      isActive: true
    }).select('name price images stock');

    // Merge cart items with product details
    const cartItems = cart.items.map(cartItem => {
      const product = products.find(p => p._id.toString() === cartItem.product);
      if (!product) return null;

      return {
        product: product._id,
        name: product.name,
        price: product.price,
        image: product.images[0]?.url || '',
        quantity: cartItem.quantity,
        stock: product.stock,
        subtotal: product.price * cartItem.quantity
      };
    }).filter(item => item !== null);

    // Calculate totals
    const total = cartItems.reduce((sum, item) => sum + item.subtotal, 0);
    const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

    res.status(200).json({
      success: true,
      data: {
        items: cartItems,
        total,
        itemCount
      }
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add item to cart
// @route   POST /api/cart/add
// @access  Private
router.post('/add', protect, async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    // Check if product exists and is active
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or not available'
      });
    }

    // Check stock availability
    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient stock available'
      });
    }

    // Get current cart
    let cart = await redisService.getCart(req.user._id.toString());
    if (!cart) {
      cart = { items: [] };
    }

    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex(
      item => item.product === productId
    );

    if (existingItemIndex > -1) {
      // Update quantity
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;
      
      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: 'Cannot add more items than available in stock'
        });
      }
      
      cart.items[existingItemIndex].quantity = newQuantity;
    } else {
      // Add new item
      cart.items.push({
        product: productId,
        quantity: quantity
      });
    }

    // Save cart to Redis
    await redisService.setCart(req.user._id.toString(), cart);

    res.status(200).json({
      success: true,
      message: 'Item added to cart successfully',
      data: {
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/update
// @access  Private
router.put('/update', protect, async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (!productId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and quantity are required'
      });
    }

    if (quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity cannot be negative'
      });
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or not available'
      });
    }

    // Get current cart
    const cart = await redisService.getCart(req.user._id.toString());
    if (!cart || !cart.items) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Find item in cart
    const itemIndex = cart.items.findIndex(item => item.product === productId);
    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    if (quantity === 0) {
      // Remove item from cart
      cart.items.splice(itemIndex, 1);
    } else {
      // Check stock availability
      if (quantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update quantity beyond available stock'
        });
      }
      
      // Update quantity
      cart.items[itemIndex].quantity = quantity;
    }

    // Save cart to Redis
    await redisService.setCart(req.user._id.toString(), cart);

    res.status(200).json({
      success: true,
      message: 'Cart updated successfully',
      data: {
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    });
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/remove/:productId
// @access  Private
router.delete('/remove/:productId', protect, async (req, res) => {
  try {
    const { productId } = req.params;

    // Get current cart
    const cart = await redisService.getCart(req.user._id.toString());
    if (!cart || !cart.items) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Find and remove item
    const itemIndex = cart.items.findIndex(item => item.product === productId);
    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    cart.items.splice(itemIndex, 1);

    // Save cart to Redis
    await redisService.setCart(req.user._id.toString(), cart);

    res.status(200).json({
      success: true,
      message: 'Item removed from cart successfully',
      data: {
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Clear entire cart
// @route   DELETE /api/cart/clear
// @access  Private
router.delete('/clear', protect, async (req, res) => {
  try {
    await redisService.deleteCart(req.user._id.toString());

    res.status(200).json({
      success: true,
      message: 'Cart cleared successfully'
    });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get cart count
// @route   GET /api/cart/count
// @access  Private
router.get('/count', protect, async (req, res) => {
  try {
    const cart = await redisService.getCart(req.user._id.toString());
    
    const itemCount = cart && cart.items 
      ? cart.items.reduce((sum, item) => sum + item.quantity, 0)
      : 0;

    res.status(200).json({
      success: true,
      data: { itemCount }
    });
  } catch (error) {
    console.error('Get cart count error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

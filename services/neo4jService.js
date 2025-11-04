const { getNeo4jDriver } = require('../config/database');

class Neo4jService {
  constructor() {
    this.driver = getNeo4jDriver();
  }

  // Get a session
  getSession() {
    return this.driver.session();
  }

  // Create product node
  async createProduct(productId, productData) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `CREATE (p:Product {
          id: $id,
          name: $name,
          category: $category,
          brand: $brand,
          price: $price,
          rating: $rating
        }) RETURN p`,
        {
          id: productId,
          name: productData.name,
          category: productData.category,
          brand: productData.brand,
          price: productData.price,
          rating: productData.rating || 0
        }
      );
      return result.records[0]?.get('p');
    } catch (error) {
      console.error('Neo4j create product error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  // Create user node
  async createUser(userId, userData) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `CREATE (u:User {
          id: $id,
          name: $name,
          email: $email
        }) RETURN u`,
        {
          id: userId,
          name: userData.name,
          email: userData.email
        }
      );
      return result.records[0]?.get('u');
    } catch (error) {
      console.error('Neo4j create user error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  // Create relationship between products (similar products)
  async createProductRelationship(productId1, productId2, relationshipType = 'SIMILAR_TO', weight = 1) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (p1:Product {id: $id1}), (p2:Product {id: $id2})
         CREATE (p1)-[r:${relationshipType} {weight: $weight}]->(p2)
         RETURN r`,
        {
          id1: productId1,
          id2: productId2,
          weight: weight
        }
      );
      return result.records[0]?.get('r');
    } catch (error) {
      console.error('Neo4j create product relationship error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  // Create user-product interaction (viewed, purchased, etc.)
  async createUserInteraction(userId, productId, interactionType = 'VIEWED', timestamp = Date.now()) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (u:User {id: $userId}), (p:Product {id: $productId})
         CREATE (u)-[r:${interactionType} {timestamp: $timestamp}]->(p)
         RETURN r`,
        {
          userId: userId,
          productId: productId,
          timestamp: timestamp
        }
      );
      return result.records[0]?.get('r');
    } catch (error) {
      console.error('Neo4j create user interaction error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  // Get product recommendations based on similar products
  async getProductRecommendations(productId, limit = 5) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (p:Product {id: $productId})-[:SIMILAR_TO]-(recommended:Product)
         RETURN recommended
         ORDER BY recommended.rating DESC
         LIMIT $limit`,
        {
          productId: productId,
          limit: limit
        }
      );
      return result.records.map(record => record.get('recommended'));
    } catch (error) {
      console.error('Neo4j get product recommendations error:', error);
      return [];
    } finally {
      await session.close();
    }
  }

  // Get user-based recommendations
  async getUserRecommendations(userId, limit = 10) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (u:User {id: $userId})-[:VIEWED|PURCHASED]->(p:Product)-[:SIMILAR_TO]-(recommended:Product)
         WHERE NOT (u)-[:VIEWED|PURCHASED]->(recommended)
         RETURN DISTINCT recommended, COUNT(*) as score
         ORDER BY score DESC, recommended.rating DESC
         LIMIT $limit`,
        {
          userId: userId,
          limit: limit
        }
      );
      return result.records.map(record => ({
        product: record.get('recommended'),
        score: record.get('score').toNumber()
      }));
    } catch (error) {
      console.error('Neo4j get user recommendations error:', error);
      return [];
    } finally {
      await session.close();
    }
  }

  // Get trending products based on interactions
  async getTrendingProducts(limit = 10, timeWindow = 7 * 24 * 60 * 60 * 1000) { // 7 days
    const session = this.getSession();
    try {
      const cutoffTime = Date.now() - timeWindow;
      const result = await session.run(
        `MATCH (u:User)-[r:VIEWED|PURCHASED]->(p:Product)
         WHERE r.timestamp > $cutoffTime
         RETURN p, COUNT(*) as interactionCount
         ORDER BY interactionCount DESC, p.rating DESC
         LIMIT $limit`,
        {
          cutoffTime: cutoffTime,
          limit: limit
        }
      );
      return result.records.map(record => ({
        product: record.get('p'),
        interactionCount: record.get('interactionCount').toNumber()
      }));
    } catch (error) {
      console.error('Neo4j get trending products error:', error);
      return [];
    } finally {
      await session.close();
    }
  }

  // Find similar users based on product interactions
  async findSimilarUsers(userId, limit = 5) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (u1:User {id: $userId})-[:VIEWED|PURCHASED]->(p:Product)<-[:VIEWED|PURCHASED]-(u2:User)
         WHERE u1 <> u2
         RETURN u2, COUNT(*) as commonProducts
         ORDER BY commonProducts DESC
         LIMIT $limit`,
        {
          userId: userId,
          limit: limit
        }
      );
      return result.records.map(record => ({
        user: record.get('u2'),
        commonProducts: record.get('commonProducts').toNumber()
      }));
    } catch (error) {
      console.error('Neo4j find similar users error:', error);
      return [];
    } finally {
      await session.close();
    }
  }

  // Get category relationships
  async getCategoryRecommendations(category, limit = 5) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (p1:Product {category: $category})-[:SIMILAR_TO]-(p2:Product)
         WHERE p2.category <> $category
         RETURN DISTINCT p2.category, COUNT(*) as frequency
         ORDER BY frequency DESC
         LIMIT $limit`,
        {
          category: category,
          limit: limit
        }
      );
      return result.records.map(record => ({
        category: record.get('p2.category'),
        frequency: record.get('frequency').toNumber()
      }));
    } catch (error) {
      console.error('Neo4j get category recommendations error:', error);
      return [];
    } finally {
      await session.close();
    }
  }

  // Delete product and its relationships
  async deleteProduct(productId) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (p:Product {id: $productId})
         DETACH DELETE p
         RETURN COUNT(p) as deleted`,
        {
          productId: productId
        }
      );
      return result.records[0]?.get('deleted').toNumber() > 0;
    } catch (error) {
      console.error('Neo4j delete product error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  // Delete user and their relationships
  async deleteUser(userId) {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (u:User {id: $userId})
         DETACH DELETE u
         RETURN COUNT(u) as deleted`,
        {
          userId: userId
        }
      );
      return result.records[0]?.get('deleted').toNumber() > 0;
    } catch (error) {
      console.error('Neo4j delete user error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  // Close driver connection
  async close() {
    await this.driver.close();
  }
}

module.exports = new Neo4jService();

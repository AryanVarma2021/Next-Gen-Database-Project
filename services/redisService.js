const { getRedisClient } = require('../config/database');

class RedisService {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      this.client = getRedisClient();
    }
    return this.client;
  }

  // Cache operations
  async set(key, value, expireInSeconds = 3600) {
    try {
      const client = this.getClient();
      if (!client) return false;
      const serializedValue = JSON.stringify(value);
      await client.setEx(key, expireInSeconds, serializedValue);
      return true;
    } catch (error) {
      console.error('Redis SET error:', error);
      return false;
    }
  }

  async get(key) {
    try {
      const client = this.getClient();
      if (!client) return null;
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Redis GET error:', error);
      return null;
    }
  }

  async del(key) {
    try {
      const client = this.getClient();
      if (!client) return false;
      await client.del(key);
      return true;
    } catch (error) {
      console.error('Redis DEL error:', error);
      return false;
    }
  }

  async exists(key) {
    try {
      const client = this.getClient();
      if (!client) return false;
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Redis EXISTS error:', error);
      return false;
    }
  }

  // Session operations
  async setSession(sessionId, sessionData, expireInSeconds = 86400) { // 24 hours
    return await this.set(`session:${sessionId}`, sessionData, expireInSeconds);
  }

  async getSession(sessionId) {
    return await this.get(`session:${sessionId}`);
  }

  async deleteSession(sessionId) {
    return await this.del(`session:${sessionId}`);
  }

  // Cart operations
  async setCart(userId, cartData, expireInSeconds = 86400) { // 24 hours
    return await this.set(`cart:${userId}`, cartData, expireInSeconds);
  }

  async getCart(userId) {
    return await this.get(`cart:${userId}`);
  }

  async deleteCart(userId) {
    return await this.del(`cart:${userId}`);
  }

  // Product cache operations
  async cacheProduct(productId, productData, expireInSeconds = 1800) { // 30 minutes
    return await this.set(`product:${productId}`, productData, expireInSeconds);
  }

  async getCachedProduct(productId) {
    return await this.get(`product:${productId}`);
  }

  async invalidateProductCache(productId) {
    return await this.del(`product:${productId}`);
  }

  // User cache operations
  async cacheUser(userId, userData, expireInSeconds = 1800) { // 30 minutes
    return await this.set(`user:${userId}`, userData, expireInSeconds);
  }

  async getCachedUser(userId) {
    return await this.get(`user:${userId}`);
  }

  async invalidateUserCache(userId) {
    return await this.del(`user:${userId}`);
  }

  // Rate limiting
  async checkRateLimit(key, limit, windowInSeconds) {
    try {
      const client = this.getClient();
      if (!client) return true;
      const current = await client.incr(key);
      if (current === 1) {
        await client.expire(key, windowInSeconds);
      }
      return current <= limit;
    } catch (error) {
      console.error('Redis rate limit error:', error);
      return true; // Allow request if Redis fails
    }
  }

  // Search cache
  async cacheSearchResults(query, results, expireInSeconds = 600) { // 10 minutes
    const key = `search:${Buffer.from(query).toString('base64')}`;
    return await this.set(key, results, expireInSeconds);
  }

  async getCachedSearchResults(query) {
    const key = `search:${Buffer.from(query).toString('base64')}`;
    return await this.get(key);
  }

  // Clear all cache (use with caution)
  async clearAllCache() {
    try {
      const client = this.getClient();
      if (!client) return false;
      const keys = await client.keys('*');
      if (keys.length > 0) {
        await client.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Redis clear cache error:', error);
      return false;
    }
  }
}

module.exports = new RedisService();

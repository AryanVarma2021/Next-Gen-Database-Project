const mongoose = require('mongoose');
const redis = require('redis');
const neo4j = require('neo4j-driver');

// MongoDB Connection
const connectMongoDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Redis Connection
let redisClient;
const connectRedis = async () => {
  try {
    redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    console.error('❌ Redis connection error:', error);
    process.exit(1);
  }
};

// Neo4j Connection
let neo4jDriver;
const connectNeo4j = async () => {
  try {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const username = process.env.NEO4J_USERNAME || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'password';

    neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    
    // Test the connection
    await neo4jDriver.verifyConnectivity();
    console.log('✅ Neo4j connected successfully');
    return neo4jDriver;
  } catch (error) {
    console.error('❌ Neo4j connection error:', error);
    process.exit(1);
  }
};

// Initialize all database connections
const connectDatabases = async () => {
  await connectMongoDB();
  await connectRedis();
  await connectNeo4j();
};

// Get database instances
const getRedisClient = () => redisClient;
const getNeo4jDriver = () => neo4jDriver;

module.exports = {
  connectDatabases,
  getRedisClient,
  getNeo4jDriver,
  connectMongoDB,
  connectRedis,
  connectNeo4j
};

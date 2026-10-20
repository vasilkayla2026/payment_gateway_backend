const mongoose = require('mongoose');

/** Connects to the MongoDB at MONGO_URI (from .env). */
module.exports = async function connectDb() {

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[db] MongoDB connected');
  } catch (error) {
    console.error('[db] MongoDB connection failed:', error.message);
    process.exit(1);
  }

};

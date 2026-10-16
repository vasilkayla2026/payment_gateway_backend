const mongoose = require('mongoose');

/** Connects to the MongoDB at MONGODB_URI. */
module.exports = async function connectDb() {

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('mongodb connected')
  } catch (error) {
    console.log(error)
    process.exit(1)
  }

};

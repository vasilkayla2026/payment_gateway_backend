const mongoose = require('mongoose');

/** A customer: saved the first time they sign in with their phone number. */
const userSchema = new mongoose.Schema(
  {
    // 10-digit Indian mobile number, without +91, e.g. "9876543210".
    phone: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('User', userSchema);

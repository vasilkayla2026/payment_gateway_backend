const mongoose = require('mongoose');

/** A Razorpay order: saved when the app asks for it, marked paid by the webhook. */
const orderSchema = new mongoose.Schema(
  {
    // Razorpay's id, e.g. "order_Abc123".
    orderId: { type: String, required: true, unique: true },
    // In paise: 824000 = ₹8,240.00.
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed'],
      default: 'created',
    },
    // Razorpay's payment id, e.g. "pay_Xyz789"; set by the webhook.
    paymentId: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model('Order', orderSchema);

// Payment backend for the Policy app. The flow:
//
//   1. App → POST /request/orderId { amount }  We create a Razorpay order.
//   2. App → Razorpay Checkout                 The customer pays Razorpay.
//   3. Razorpay → POST /razorpay/webhook       We mark the order paid.
require('dotenv').config();

const crypto = require('crypto');
const cors = require('cors');
const express = require('express');
const Razorpay = require('razorpay');

const connectDb = require('./db');
const Order = require('./models/order');

var {
    PORT = 3000,
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
} = process.env;

// Without it no webhook can be checked, and an empty one would let anyone
// sign a fake "paid" event. So stop here rather than run half-working.
if (!RAZORPAY_WEBHOOK_SECRET) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set; see .env.example');
    process.exit(1);
}

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

const app = express();
// The Flutter web app runs on another origin (port), so allow it in.
app.use(cors('*'));

// 3. Razorpay calls this when something happens to a payment. It reads the
// raw body because the signature is computed over the exact bytes sent, so
// it must come before express.json().
app.post(
    '/razorpay/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const signature = req.get('x-razorpay-signature');
        if (!isFromRazorpay(req.body, signature)) {
            return res.status(400).send('Invalid signature');
        }

        const event = JSON.parse(req.body.toString());
        const payment = event.payload.payment?.entity;

        if (event.event === 'payment.captured' || event.event === 'order.paid') {
            // Both can arrive for one payment, and Razorpay may resend either;
            // setting the same values again is harmless.
            await Order.updateOne(
                { orderId: payment.order_id },
                { status: 'paid', paymentId: payment.id },
            );
            console.log(`Paid: ${payment.order_id} by ${payment.id}`);
        } else if (event.event === 'payment.failed') {
            // A failed attempt never undoes a successful one on the same order.
            await Order.updateOne(
                { orderId: payment.order_id, status: { $ne: 'paid' } },
                { status: 'failed' },
            );
            console.log(`Failed: ${payment.order_id}`);
        }

        // Answer 200 quickly; anything else makes Razorpay retry.
        res.sendStatus(200);
    },
);

app.use(express.json());

// 1. The app asks for an order before opening Checkout.
app.post('/request/orderId', async (req, res) => {
    const amount = req.body?.amount;
    if (!Number.isInteger(amount) || amount < 100) {
        return res
            .status(400)
            .json({ message: 'amount must be whole paise, at least 100 (₹1)' });
    }

    const order = await razorpay.orders.create({
        amount,
        currency: 'INR',
        receipt: `policy_${Date.now()}`,
    });
    await Order.create({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
    });

    // The key id is public: Checkout needs it. The secret never leaves here.
    res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: RAZORPAY_KEY_ID,
    });
});

// To see what the webhook recorded, e.g. open it in a browser.
app.get('/request/orderStatus/:orderId', async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ message: 'No such order' });
    res.json({
        orderId: order.orderId,
        amount: order.amount,
        status: order.status,
        paymentId: order.paymentId,
    });
});

app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ message: 'Something went wrong' });
});

/**
 * Razorpay signs each webhook with your webhook secret (HMAC-SHA256 of the
 * body). Recomputing it proves the call came from Razorpay, not from someone
 * who found the URL.
 */
function isFromRazorpay(rawBody, signature) {
    if (!RAZORPAY_WEBHOOK_SECRET || !signature || !Buffer.isBuffer(rawBody)) {
        return false;
    }
    const expected = Buffer.from(
        crypto
            .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
            .update(rawBody)
            .digest('hex'),
    );
    // Compare bytes, not characters: timingSafeEqual throws when the byte
    // lengths differ, and a non-ASCII header can match in characters only.
    const received = Buffer.from(signature);
    return (
        expected.length === received.length &&
        crypto.timingSafeEqual(expected, received)
    );
}

connectDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});

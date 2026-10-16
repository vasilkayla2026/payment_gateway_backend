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
var PORT =3000;
var {
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

// Print every request that reaches the server, with the time. If a webhook
// never shows up here, Razorpay can't reach this server (see README → Webhook).
app.use((req, res, next) => {

    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.originalUrl}`);
    next();
});

// 3. Razorpay calls this when something happens to a payment. It reads the
// raw body because the signature is computed over the exact bytes sent, so
// it must come before express.json().
app.post(
    '/razorpay/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {

        const signature = req.get('x-razorpay-signature');
        if (!isFromRazorpay(req.body, signature)) {
            console.warn(
                '[webhook] Rejected: signature missing or wrong. Does ' +
                    'RAZORPAY_WEBHOOK_SECRET match the secret in the Razorpay Dashboard?',
            );
            return res.status(400).send('Invalid signature');
        }

        const event = JSON.parse(req.body.toString());
        const payment = event.payload.payment?.entity;
        console.log(`[webhook] Signature OK, event: ${event.event}`);
        if (payment) {
            console.log(
                `[webhook] Payment ${payment.id} for ${payment.order_id}: ` +
                    `${payment.amount} paise by ${payment.method}, status ${payment.status}`,
            );
        }

        if (event.event === 'payment.captured' || event.event === 'order.paid') {
            // Both can arrive for one payment, and Razorpay may resend either;
            // setting the same values again is harmless.
            const result = await Order.updateOne(
                { orderId: payment.order_id },
                { status: 'paid', paymentId: payment.id },
            );
            if (result.matchedCount === 0) {
                console.log(`[webhook] No order ${payment.order_id} in MongoDB; nothing saved`);
            } else {
                console.log(`[webhook] Order ${payment.order_id} saved as paid`);
            }
        } else if (event.event === 'payment.failed') {
            // A failed attempt never undoes a successful one on the same order.
            const result = await Order.updateOne(
                { orderId: payment.order_id, status: { $ne: 'paid' } },
                { status: 'failed' },
            );
            if (result.matchedCount === 0) {
                console.log(
                    `[webhook] Order ${payment.order_id} not changed: not in MongoDB, or already paid`,
                );
            } else {
                console.log(
                    `[webhook] Order ${payment.order_id} saved as failed: ${payment.error_description}`,
                );
            }
        } else {
            console.log(`[webhook] Nothing to do for ${event.event}`);
        }

        // Answer 200 quickly; anything else makes Razorpay retry.
        res.sendStatus(200);
    },
);

app.use(express.json());

// 1. The app asks for an order before opening Checkout.
app.post('/request/orderId', async (req, res) => {
    console.log()
    const amount = req.body?.amount;
    if (!Number.isInteger(amount) || amount < 100) {
        console.log(`[order] Rejected, the app sent: ${JSON.stringify(req.body)}`);
        return res
            .status(400)
            .json({ message: 'amount must be whole paise, at least 100 (₹1)' });
    }

    const order = await razorpay.orders.create({
        amount,
        currency: 'INR',
        receipt: `policy_${Date.now()}`,
    });
    console.log(
        `[order] Razorpay created ${order.id} for ${order.amount} paise, status: ${order.status}`,
    );
    await Order.create({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
    });
    console.log(`[order] Saved ${order.id} in MongoDB`);

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
    if (!order) {
        console.log(`[status] No order ${req.params.orderId} in MongoDB`);
        return res.status(404).json({ message: 'No such order' });
    }
    console.log(`[status] Order ${order.orderId} is ${order.status}`);
    res.json({
        orderId: order.orderId,
        amount: order.amount,
        status: order.status,
        paymentId: order.paymentId,
    });
});

// The app's payment history: the 50 newest orders with what the webhook
// recorded. There is no sign-in yet, so this is everyone's orders.
app.get('/request/orders', async (req, res) => {
    console.log("orders history api is called")
    const orders = await Order.find().sort({ createdAt: -1 }).limit(50).lean();
    console.log(`[history] Sent ${orders.length} orders`);
    res.json({
        orders: orders.map((order) => ({
            orderId: order.orderId,
            amount: order.amount,
            currency: order.currency,
            status: order.status,
            paymentId: order.paymentId,
            createdAt: order.createdAt,
        })),
    });
    console.log('order history is:', orders);
});

app.use((error, req, res, next) => {
    console.error(`[error] ${req.method} ${req.originalUrl} failed:`, error);
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

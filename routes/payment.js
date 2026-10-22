const express = require('express');
const Razorpay = require('razorpay');

const Order = require('../models/order');

// ---------- Razorpay settings, read from the .env file ----------

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Without this secret we can't tell a real Razorpay call from a fake one,
// so don't start at all.
if (!RAZORPAY_WEBHOOK_SECRET) {
    console.error('RAZORPAY_WEBHOOK_SECRET is missing in .env (see .env.example)');
    process.exit(1);
}

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

const router = express.Router();

// ---------- Step 1: the app asks for an order ----------
//
// The app sends { "amount": 824000 }. Amounts are in paise (₹1 = 100 paise),
// so 824000 means ₹8,240.
router.post('/request/orderId', express.json(), async (req, res) => {
    // ?. gives undefined instead of crashing when the app sent no body.
    const amount = req.body?.amount;
    if (!Number.isInteger(amount) || amount < 100) {
        console.log('[order] Rejected, the app sent:', req.body);
        return res.status(400).json({ message: 'amount must be whole paise, at least 100 (₹1)' });
    }

    // Ask Razorpay to create the order.
    const order = await razorpay.orders.create({
        amount: amount,
        currency: 'INR',
        receipt: `policy_${Date.now()}`,
    });

    // Save it in MongoDB. Its status starts as "created".
    await Order.create({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
    });
    console.log(`[order] Created ${order.id} for ${order.amount} paise`);

    // The app needs these to open Razorpay Checkout. The key id is safe to
    // share; the key secret never leaves this server.
    res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: RAZORPAY_KEY_ID,
    });
});

// ---------- Step 3: Razorpay tells us how the payment went ----------

// Razorpay signs every webhook with your webhook secret. If the signature
// matches, the call really came from Razorpay and not from someone who found
// the URL. The Razorpay SDK does the checking for us.
function isFromRazorpay(req) {
    const signature = req.get('x-razorpay-signature');
    if (!signature || !req.body) {
        return false;
    }
    return Razorpay.validateWebhookSignature(req.body.toString(), signature, RAZORPAY_WEBHOOK_SECRET);
}

// express.raw() keeps the body exactly as Razorpay sent it, because the
// signature is checked against those exact bytes.
router.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!isFromRazorpay(req)) {
        console.warn('[webhook] Rejected: wrong signature. Is RAZORPAY_WEBHOOK_SECRET the same as in the Razorpay Dashboard?');
        return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString());
    console.log(`[webhook] Event: ${event.event}`);

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
        // Razorpay may send both events for one payment, or send one twice.
        // Saving "paid" again does no harm.
        const payment = event.payload.payment.entity;
        const result = await Order.updateOne(
            { orderId: payment.order_id },
            { status: 'paid', paymentId: payment.id },
        );
        if (result.matchedCount === 0) {
            console.log(`[webhook] Order ${payment.order_id} is not in MongoDB`);
        } else {
            console.log(`[webhook] Order ${payment.order_id} saved as paid`);
        }
    } else if (event.event === 'payment.failed') {
        // Only orders that are not paid yet: the customer may have retried
        // and paid, and a failed try must not undo that.
        const payment = event.payload.payment.entity;
        const result = await Order.updateOne(
            { orderId: payment.order_id, status: { $ne: 'paid' } },
            { status: 'failed' },
        );
        if (result.matchedCount === 0) {
            console.log(`[webhook] Order ${payment.order_id} not changed: not in MongoDB, or already paid`);
        } else {
            console.log(`[webhook] Order ${payment.order_id} saved as failed: ${payment.error_description}`);
        }
    }

    // Reply 200 so Razorpay knows we got it; otherwise it sends it again.
    res.sendStatus(200);
});

// ---------- Look up orders ----------

// One order, e.g. open /request/orderStatus/order_Abc123 in a browser.
router.get('/request/orderStatus/:orderId', async (req, res) => {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) {
        return res.status(404).json({ message: 'No such order' });
    }
    res.json({
        orderId: order.orderId,
        amount: order.amount,
        status: order.status,
        paymentId: order.paymentId,
    });
});

// The app's payment history: the 50 newest orders. Orders aren't linked to a
// user yet (that needs a sign-in token), so this is everyone's orders.
router.get('/request/orders', async (req, res) => {
    const orders = await Order.find()
        .sort({ createdAt: -1 }) // newest first
        .limit(50)
        .select('orderId amount currency status paymentId createdAt -_id'); // only these fields
    console.log(`[history] Sent ${orders.length} orders`);
    res.json({ orders: orders });
});

module.exports = router;

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const connectDb = require('./db');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');

// ---------- Settings, read from the .env file ----------

const PORT = process.env.PORT || 3000;

const app = express();

// Let the Flutter web app, which runs on another port, call this server.
app.use(cors());

// Print every request, so you can see what reaches the server.
app.use((req, res, next) => {
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.originalUrl}`);
    next();
});

// ---------- Routes ----------

// Sign in with phone and OTP: /auth/sendOtp, /auth/verifyOtp.
app.use(authRoutes);
// Orders, the Razorpay webhook and payment history: /request/..., /razorpay/webhook.
app.use(paymentRoutes);

// ---------- Errors ----------

// If a route throws (say Razorpay or MongoDB is down), Express comes here,
// and the app gets a plain 500 reply instead of a hanging request.
app.use((error, req, res, next) => {
    console.error(`[error] ${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({ message: 'Something went wrong' });
});

// ---------- Start: connect to MongoDB, then listen ----------

connectDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});

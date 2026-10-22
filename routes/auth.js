const express = require('express');

const User = require('../models/user');

const router = express.Router();

// ---------- Sign in with phone number and OTP ----------
//
// For testing only: no SMS is sent, and the OTP is always 123456. Anyone can
// sign in as any phone number, so replace this with a real SMS provider
// before going live.
const TEST_OTP = '123456';

// A 10-digit Indian mobile number, without +91: starts with 6, 7, 8 or 9.
function isPhoneNumber(phone) {
    return typeof phone === 'string' && /^[6-9]\d{9}$/.test(phone);
}

// The app sends { "phone": "9876543210" }.
router.post('/auth/sendOtp', express.json(), (req, res) => {
    const phone = req.body?.phone;
    if (!isPhoneNumber(phone)) {
        console.log('[auth] Rejected, the app sent:', req.body);
        return res.status(400).json({ message: 'phone must be a 10-digit mobile number, e.g. "9876543210"' });
    }

    // A real server would text a random OTP here. We only pretend.
    console.log(`[auth] OTP for ${phone} is ${TEST_OTP} (test OTP, no SMS sent)`);
    res.json({ message: 'OTP sent' });
});

// The app sends { "phone": "9876543210", "otp": "123456" }.
router.post('/auth/verifyOtp', express.json(), async (req, res) => {
    const phone = req.body?.phone;
    // String() so the OTP works whether the app sends "123456" or 123456.
    const otp = String(req.body?.otp);
    if (!isPhoneNumber(phone)) {
        console.log('[auth] Rejected, the app sent:', req.body);
        return res.status(400).json({ message: 'phone must be a 10-digit mobile number, e.g. "9876543210"' });
    }
    if (otp !== TEST_OTP) {
        console.log(`[auth] Wrong OTP for ${phone}`);
        return res.status(401).json({ message: 'Wrong OTP' });
    }

    // Find the user with this phone, or create one on their first sign-in.
    // upsert does both in one step, so two taps on "Verify" can't make two users.
    const user = await User.findOneAndUpdate(
        { phone: phone },
        { $setOnInsert: { phone: phone } },
        { upsert: true, returnDocument: 'after' },
    );
    console.log(`[auth] ${phone} signed in as user ${user.id}`);

    // No token yet: the app just keeps these to know who signed in.
    res.json({
        userId: user.id,
        phone: user.phone,
    });
});

module.exports = router;

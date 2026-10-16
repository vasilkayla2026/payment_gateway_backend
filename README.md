# payment_gateway_backend

Backend for the Policy app's Razorpay payments: Express, MongoDB (mongoose) and the
Razorpay Node SDK.

## Flow

1. **App → `POST /request/orderId`** with `{"amount": 824000}` (paise). The server creates a
   Razorpay order, saves it in MongoDB as `created`, and returns
   `{"orderId", "amount", "currency", "keyId"}`.
2. **App → Razorpay Checkout** with that order. The customer pays Razorpay directly.
3. **Razorpay → `POST /razorpay/webhook`**. The server checks the signature, then marks the
   order `paid` (`payment.captured`, `order.paid`) or `failed` (`payment.failed`).

`GET /request/orderStatus/:orderId` shows what the webhook recorded, and `GET /request/orders`
lists the 50 newest orders for the app's payment history. There is no sign-in yet, so that list
is everyone's orders: add customers before going live.

## Run

```sh
npm install
cp .env.example .env     # then fill in the values
npm run dev              # restarts on changes; `npm start` for a plain run
```

You need a MongoDB (local, Docker or Atlas) at `MONGODB_URI`.

## Razorpay Dashboard (test mode first)

1. **API keys**: Account & Settings → API Keys → generate test keys. Put them in
   `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. **Webhook**: Account & Settings → Webhooks → Add New Webhook.
   - URL: `https://<public-url>/razorpay/webhook`. Razorpay can't reach `localhost`, so
     during development expose the server with a tunnel, e.g. `ngrok http 3000`.
   - Secret: a long random string, e.g. from `openssl rand -hex 32`. Razorpay calls it
     optional, but set it: the same value goes in `RAZORPAY_WEBHOOK_SECRET`, and the server
     won't start without it.
   - Events: `payment.captured`, `order.paid` and `payment.failed`.
3. **Payment capture**: keep automatic capture on (the default), or payments stay
   "authorized" and Razorpay refunds them.

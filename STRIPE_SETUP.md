# Stripe Integration — Complete Setup Guide

> **Time to live payments: ~20 minutes**
> This guide takes you from zero to accepting real subscriptions.

---

## Overview

LottoPro uses **Stripe Checkout** (hosted payment page) for subscriptions.

```
User clicks "Upgrade"
  → StripeCheckout modal (collect email)
    → POST /stripe/create-checkout-session  (backend)
      → Stripe-hosted payment page
        → Payment succeeds
          → Stripe webhook fires (backend updates plan)
          → Stripe redirects to /?checkout=success&plan=pro
            → CheckoutSuccess overlay activates the plan in UI
```

---

## Step 1 — Create a Stripe Account

1. Go to **https://dashboard.stripe.com/register**
2. Verify your email and complete business profile
3. To accept live payments you'll need to:
   - Add business details (name, address, bank account)
   - Complete identity verification (takes 1–2 business days)
4. For **testing**, you can skip verification — use test mode (toggle in top-left of dashboard)

---

## Step 2 — Get Your API Keys

1. Open **Developers → API Keys** in the Stripe Dashboard
2. Copy two keys:

| Key | Where to find | Starts with |
|-----|--------------|-------------|
| **Publishable key** | "Publishable key" row | `pk_test_...` or `pk_live_...` |
| **Secret key** | Click "Reveal" on "Secret key" row | `sk_test_...` or `sk_live_...` |

> ⚠️ **Never commit the secret key to git.**

---

## Step 3 — Create Products & Prices

You need **4 Stripe prices** (Pro Monthly, Pro Annual, Elite Monthly, Elite Annual).

### 3a. Create the Pro product

1. Go to **Products → Add product**
2. Name: `LottoPro Pro`
3. Description: `50 predictions/day · All games · CSV Export · 5,000 API calls`
4. Add pricing:
   - Click **"Add price"**
   - Recurring · Monthly · **$9.99 USD**
   - Copy the price ID (looks like `price_1AbcXX...`) → paste into `.env` as `STRIPE_PRICE_PRO_MONTHLY`
5. Add a second price for annual:
   - Recurring · Every 12 months · **$95.88 USD** (≈ $7.99/mo · 20% off)
   - Copy → `STRIPE_PRICE_PRO_ANNUAL`

### 3b. Create the Elite product

1. **Products → Add product**
2. Name: `LottoPro Elite`
3. Add pricing:
   - Monthly · **$29.99 USD** → `STRIPE_PRICE_ELITE_MONTHLY`
   - Annual  · **$287.88 USD** (≈ $23.99/mo) → `STRIPE_PRICE_ELITE_ANNUAL`

---

## Step 4 — Configure Your `.env` File

```bash
# Navigate to backend
cd /home/user/webapp/backend

# Copy the example
cp .env.example .env
```

Edit `backend/.env`:

```ini
# ── Stripe Keys ──────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY_HERE

# ── Stripe Webhook (fill in Step 5) ──────────────────────────
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE

# ── Stripe Price IDs ─────────────────────────────────────────
STRIPE_PRICE_PRO_MONTHLY=price_XXXX_pro_monthly
STRIPE_PRICE_PRO_ANNUAL=price_XXXX_pro_annual
STRIPE_PRICE_ELITE_MONTHLY=price_XXXX_elite_monthly
STRIPE_PRICE_ELITE_ANNUAL=price_XXXX_elite_annual

# ── App URL (change to your domain in production) ────────────
FRONTEND_URL=http://localhost:3010

# ── API Key signing secret (change to a random string!) ──────
API_KEY_SECRET=change_me_to_a_random_64_char_hex_string
```

Generate a strong `API_KEY_SECRET`:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## Step 5 — Set Up the Stripe Webhook

The webhook tells your backend when payments succeed, fail, or subscriptions change.

### For local development (using Stripe CLI)

```bash
# Install Stripe CLI
# macOS:  brew install stripe/stripe-cli/stripe
# Linux:  https://stripe.com/docs/stripe-cli#install

# Login
stripe login

# Forward webhooks to your local backend (port 8000)
stripe listen --forward-to http://localhost:8000/stripe/webhook

# The CLI will print a webhook signing secret like:
#   whsec_test_abc123...
# Copy it → paste into .env as STRIPE_WEBHOOK_SECRET
```

Keep this terminal running while testing.

### For production (deployed server)

1. Go to **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://your-domain.com/stripe/webhook`
3. Events to listen to (select all of these):
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.trial_will_end`
4. Click **Add endpoint**
5. Under "Signing secret" → **Reveal** → copy → paste into `.env` as `STRIPE_WEBHOOK_SECRET`

---

## Step 6 — Start the Backend

```bash
cd /home/user/webapp/backend

# Install dependencies (if not already done)
pip install fastapi uvicorn stripe python-dotenv pydantic httpx

# Start the API server
uvicorn main:app --reload --port 8000
```

Verify Stripe routes are registered:
```bash
curl http://localhost:8000/stripe/prices
```
Expected response:
```json
{
  "publishable_key": "pk_test_...",
  "plans": { "pro": {...}, "elite": {...} },
  "stripe_configured": true
}
```

---

## Step 7 — Start the Frontend

```bash
cd /home/user/webapp/frontend
npm start   # runs on port 3010
```

Or open the existing dev server at:
`http://localhost:3010`

---

## Step 8 — Test the Full Flow

### Test card numbers (no real charges in test mode):

| Scenario | Card Number | CVV | Expiry |
|----------|------------|-----|--------|
| Success | `4242 4242 4242 4242` | Any 3 digits | Any future date |
| Declined | `4000 0000 0000 0002` | Any | Any |
| 3D Secure | `4000 0025 0000 3155` | Any | Any |
| Insufficient funds | `4000 0000 0000 9995` | Any | Any |

### Full test walkthrough:

1. Open `http://localhost:3010`
2. Click **Upgrade** (or the pricing page)
3. Select **Pro** or **Elite**
4. Enter an email address → **Continue to Secure Checkout**
5. On Stripe's hosted page: enter `4242 4242 4242 4242`, any CVV, any future date
6. Click **Subscribe**
7. Stripe redirects to `/?checkout=success&plan=pro`
8. 🎉 CheckoutSuccess overlay appears
9. Click **Start Predicting Now →** — plan is activated

### Verify in Stripe Dashboard:
- **Customers** → your test email should appear
- **Subscriptions** → shows active subscription
- **Payments** → shows the $9.99 charge

### Verify in backend logs:
```
INFO checkout.session.completed — plan=pro email=test@example.com
INFO Plan activated: test@example.com → pro
```

---

## Step 9 — Enable the Customer Billing Portal

Lets users update their card, cancel, or view invoices.

1. Go to **Settings → Billing → Customer portal**
2. Toggle on: "Allow customers to cancel subscriptions"
3. Toggle on: "Allow customers to update subscriptions"
4. Toggle on: "Allow customers to switch plans"
5. Click **Save**

Users can access it via the **"Manage Billing"** button in the app's API/Account tab.

---

## Step 10 — Go Live Checklist

Before switching to live keys:

- [ ] Complete Stripe account verification (business details + bank)
- [ ] Create products and prices in **live mode** (not test mode) and update `.env`
- [ ] Switch `.env` keys from `sk_test_` / `pk_test_` to `sk_live_` / `pk_live_`
- [ ] Create a live webhook endpoint pointing to your production domain
- [ ] Update `FRONTEND_URL` in `.env` to your production URL
- [ ] Generate a new strong `API_KEY_SECRET` for production
- [ ] Deploy backend with the new `.env` (never commit it!)
- [ ] Test with a real card (small $1 test charge, then refund)
- [ ] Replace the in-memory `customer_store` with a real database (Postgres/SQLite)

---

## Database Upgrade (Production)

The current backend uses an **in-memory dict** — data is lost on restart.

For production, replace `customer_store` in `stripe_routes.py` with a real DB:

### SQLite (simple, single-server)

```python
import sqlite3
import json

DB_PATH = "lottopro.db"

def _db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            email TEXT PRIMARY KEY,
            data  TEXT NOT NULL
        )
    """)
    return con

def _get_customer(email: str) -> dict:
    with _db() as con:
        row = con.execute("SELECT data FROM customers WHERE email=?", (email,)).fetchone()
        return json.loads(row[0]) if row else {}

def _set_customer(email: str, data: dict):
    with _db() as con:
        con.execute(
            "INSERT INTO customers (email, data) VALUES (?,?) "
            "ON CONFLICT(email) DO UPDATE SET data=excluded.data",
            (email, json.dumps(data))
        )
```

Then replace `customer_store[email]` calls with `_get_customer(email)` / `_set_customer(email, data)`.

### PostgreSQL (production-grade)

Use SQLAlchemy or Tortoise ORM with a `customers` table. See [Stripe's Python samples](https://github.com/stripe-samples) for full examples.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | ✅ | Backend API key (never expose to frontend) |
| `STRIPE_PUBLISHABLE_KEY` | ✅ | Frontend key (safe to expose) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Verifies webhook authenticity |
| `STRIPE_PRICE_PRO_MONTHLY` | ✅ | Stripe Price ID for Pro monthly |
| `STRIPE_PRICE_PRO_ANNUAL` | ✅ | Stripe Price ID for Pro annual |
| `STRIPE_PRICE_ELITE_MONTHLY` | ✅ | Stripe Price ID for Elite monthly |
| `STRIPE_PRICE_ELITE_ANNUAL` | ✅ | Stripe Price ID for Elite annual |
| `FRONTEND_URL` | ✅ | Base URL for Stripe success/cancel redirects |
| `API_KEY_SECRET` | ✅ | Secret for signing user API keys |
| `REACT_APP_API_URL` | Optional | Frontend: backend base URL (empty = same origin) |

---

## Troubleshooting

| Problem | Solution |
|---------|---------|
| `Stripe is not configured` error | Check `STRIPE_SECRET_KEY` in `backend/.env` |
| `No Stripe Price ID configured` error | Add price IDs to `.env` (Step 3 above) |
| Webhook not receiving events | Run `stripe listen` CLI (local) or check webhook URL (production) |
| Webhook signature fails | Ensure you're using the correct `STRIPE_WEBHOOK_SECRET` |
| Plan doesn't activate after payment | Check backend logs; make sure webhook fired `checkout.session.completed` |
| Customer portal returns 403 | Enable the portal in Stripe Dashboard → Settings → Billing |
| In-memory store lost data | Restart the backend; implement DB persistence for production |

---

## API Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/stripe/create-checkout-session` | Create Stripe Checkout session |
| `POST` | `/stripe/create-portal-session` | Open Stripe Customer Portal |
| `POST` | `/stripe/webhook` | Stripe webhook receiver |
| `GET` | `/stripe/subscription-status?email=...` | Get current plan for email |
| `POST` | `/stripe/cancel-subscription` | Cancel at period end |
| `GET` | `/stripe/prices` | Return configured plan prices |

---

*Last updated: March 2026 · Stripe SDK v14+*

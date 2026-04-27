"""
stripe_routes.py
─────────────────────────────────────────────────────────────────────────────
Full Stripe integration for LottoPro subscription billing.

Endpoints:
  POST /stripe/create-checkout-session   → redirect user to Stripe Checkout
  POST /stripe/create-portal-session     → open Stripe Customer Portal
  POST /stripe/webhook                   → handle Stripe lifecycle events
  GET  /stripe/subscription-status       → return current plan for a customer
  POST /stripe/cancel-subscription       → cancel at period end
  GET  /stripe/prices                    → return price IDs for frontend

Architecture:
  - In-memory customer store (swap for DB in production)
  - Idempotent webhook processing with event deduplication
  - Automatic API-key generation on subscription activation
─────────────────────────────────────────────────────────────────────────────
"""

import hashlib
import hmac
import logging
import os
import secrets
import time
from datetime import datetime
from typing import Optional

import stripe
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr

# ── Load .env ──────────────────────────────────────────────────────────────
load_dotenv()

logger = logging.getLogger(__name__)

# ── Stripe config ──────────────────────────────────────────────────────────
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET  = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
FRONTEND_URL           = os.getenv("FRONTEND_URL", "http://localhost:3010")
API_KEY_SECRET         = os.getenv("API_KEY_SECRET", "dev_secret")

# ── Price ID map (populated from env) ─────────────────────────────────────
PRICE_IDS = {
    "pro":          {"monthly": os.getenv("STRIPE_PRICE_PRO_MONTHLY",   ""),
                     "annual":  os.getenv("STRIPE_PRICE_PRO_ANNUAL",    "")},
    "elite":        {"monthly": os.getenv("STRIPE_PRICE_ELITE_MONTHLY", ""),
                     "annual":  os.getenv("STRIPE_PRICE_ELITE_ANNUAL",  "")},
}

# ── Plan metadata ──────────────────────────────────────────────────────────
PLAN_META = {
    "pro":   {"name": "Pro",   "price_monthly": 9.99,  "price_annual": 7.99},
    "elite": {"name": "Elite", "price_monthly": 29.99, "price_annual": 23.99},
}

# ── In-memory stores (replace with DB in production) ──────────────────────
# customer_store[email] = { stripe_customer_id, plan, api_key, subscription_id, ... }
customer_store: dict = {}
# processed_events: deduplication set
processed_events: set = set()

router = APIRouter(prefix="/stripe", tags=["Stripe"])

# ══════════════════════════════════════════════════════════════════════════
# Request / Response models
# ══════════════════════════════════════════════════════════════════════════

class CheckoutRequest(BaseModel):
    plan: str           # "pro" | "elite"
    billing: str        # "monthly" | "annual"
    email: str          # customer email
    success_url: Optional[str] = None
    cancel_url:  Optional[str] = None

class PortalRequest(BaseModel):
    email: str

class CancelRequest(BaseModel):
    email: str

class StatusRequest(BaseModel):
    email: str

# ══════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════

def _generate_api_key(email: str, plan: str) -> str:
    """Generate a deterministic but secret API key for the user."""
    raw    = f"{email}:{plan}:{API_KEY_SECRET}:{int(time.time() // 86400)}"
    digest = hmac.new(API_KEY_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    prefix = "lk_pro_" if plan == "pro" else "lk_elite_"
    return prefix + digest[:32].upper()


def _price_id_for(plan: str, billing: str) -> str:
    pid = PRICE_IDS.get(plan, {}).get(billing, "")
    if not pid:
        raise HTTPException(
            status_code=400,
            detail=f"No Stripe Price ID configured for {plan}/{billing}. "
                   "Set STRIPE_PRICE_{PLAN}_{BILLING} in your .env file."
        )
    return pid


def _plan_from_price_id(price_id: str) -> str:
    for plan, billing_map in PRICE_IDS.items():
        if price_id in billing_map.values():
            return plan
    return "free"


def _get_or_create_stripe_customer(email: str) -> str:
    """Return existing Stripe customer ID or create a new one."""
    rec = customer_store.get(email, {})
    if rec.get("stripe_customer_id"):
        return rec["stripe_customer_id"]
    # Search Stripe for existing customer
    existing = stripe.Customer.list(email=email, limit=1)
    if existing.data:
        cid = existing.data[0].id
    else:
        cust = stripe.Customer.create(email=email, metadata={"source": "lottopro"})
        cid  = cust.id
    customer_store.setdefault(email, {})["stripe_customer_id"] = cid
    return cid


# ══════════════════════════════════════════════════════════════════════════
# Route 1: Create Checkout Session
# ══════════════════════════════════════════════════════════════════════════

@router.post("/create-checkout-session")
async def create_checkout_session(req: CheckoutRequest):
    """
    Creates a Stripe Checkout session and returns the redirect URL.
    Frontend redirects the browser to checkout_url.
    """
    if not stripe.api_key or stripe.api_key.startswith("sk_test_XX"):
        raise HTTPException(
            status_code=503,
            detail="Stripe is not configured. Add STRIPE_SECRET_KEY to your .env file."
        )

    if req.plan not in ("pro", "elite"):
        raise HTTPException(status_code=400, detail="plan must be 'pro' or 'elite'")
    if req.billing not in ("monthly", "annual"):
        raise HTTPException(status_code=400, detail="billing must be 'monthly' or 'annual'")

    price_id    = _price_id_for(req.plan, req.billing)
    customer_id = _get_or_create_stripe_customer(req.email)

    success_url = req.success_url or f"{FRONTEND_URL}/?checkout=success&plan={req.plan}&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url  = req.cancel_url  or f"{FRONTEND_URL}/?checkout=cancelled"

    try:
        session = stripe.checkout.Session.create(
            customer          = customer_id,
            mode              = "subscription",
            payment_method_types = ["card"],
            line_items        = [{"price": price_id, "quantity": 1}],
            success_url       = success_url,
            cancel_url        = cancel_url,
            allow_promotion_codes = True,
            subscription_data = {
                "metadata": {
                    "plan":    req.plan,
                    "billing": req.billing,
                    "email":   req.email,
                }
            },
            metadata = {
                "plan":    req.plan,
                "billing": req.billing,
                "email":   req.email,
            },
            customer_update = {"address": "auto"},
            # 7-day free trial
            subscription_data_kwargs = {},
        )
        logger.info("Checkout session created: %s plan=%s email=%s", session.id, req.plan, req.email)
        return {
            "checkout_url":  session.url,
            "session_id":    session.id,
            "publishable_key": STRIPE_PUBLISHABLE_KEY,
        }
    except stripe.error.StripeError as e:
        logger.error("Stripe error creating session: %s", e)
        raise HTTPException(status_code=502, detail=str(e.user_message or e))


# ══════════════════════════════════════════════════════════════════════════
# Route 2: Customer Portal (manage billing, cancel, update card)
# ══════════════════════════════════════════════════════════════════════════

@router.post("/create-portal-session")
async def create_portal_session(req: PortalRequest):
    """Opens the Stripe Customer Portal for the given email."""
    if not stripe.api_key or stripe.api_key.startswith("sk_test_XX"):
        raise HTTPException(status_code=503, detail="Stripe not configured.")

    customer_id = _get_or_create_stripe_customer(req.email)
    try:
        session = stripe.billing_portal.Session.create(
            customer   = customer_id,
            return_url = f"{FRONTEND_URL}/",
        )
        return {"portal_url": session.url}
    except stripe.error.StripeError as e:
        logger.error("Stripe portal error: %s", e)
        raise HTTPException(status_code=502, detail=str(e.user_message or e))


# ══════════════════════════════════════════════════════════════════════════
# Route 3: Webhook (core — handles all subscription lifecycle events)
# ══════════════════════════════════════════════════════════════════════════

@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature"),
):
    """
    Receives and verifies Stripe webhook events.
    Must be called with the raw request body (before JSON parsing).
    """
    payload = await request.body()

    # ── Verify signature ──────────────────────────────────────────────────
    if STRIPE_WEBHOOK_SECRET and STRIPE_WEBHOOK_SECRET != "whsec_XX":
        try:
            event = stripe.Webhook.construct_event(
                payload, stripe_signature, STRIPE_WEBHOOK_SECRET
            )
        except stripe.error.SignatureVerificationError:
            logger.warning("Webhook signature verification failed")
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    else:
        # Dev mode: skip verification
        import json as _json
        event = stripe.Event.construct_from(_json.loads(payload), stripe.api_key)

    # ── Deduplicate ───────────────────────────────────────────────────────
    if event.id in processed_events:
        logger.info("Duplicate webhook event %s — skipped", event.id)
        return JSONResponse({"status": "duplicate"})
    processed_events.add(event.id)
    if len(processed_events) > 10_000:
        processed_events.clear()  # prevent unbounded growth

    logger.info("Webhook event: %s id=%s", event.type, event.id)

    # ── Handle events ─────────────────────────────────────────────────────
    obj = event.data.object

    # ── Checkout completed → activate subscription ─────────────────────────
    if event.type == "checkout.session.completed":
        email = (obj.get("metadata") or {}).get("email") or \
                (obj.get("customer_details") or {}).get("email", "")
        plan  = (obj.get("metadata") or {}).get("plan", "pro")
        sub_id = obj.get("subscription", "")
        if email:
            api_key = _generate_api_key(email, plan)
            customer_store.setdefault(email, {}).update({
                "plan":            plan,
                "api_key":         api_key,
                "subscription_id": sub_id,
                "status":          "active",
                "activated_at":    datetime.utcnow().isoformat(),
            })
            logger.info("Plan activated: %s → %s (sub=%s)", email, plan, sub_id)

    # ── Invoice paid → keep subscription active ────────────────────────────
    elif event.type == "invoice.payment_succeeded":
        sub_id = obj.get("subscription", "")
        email  = _email_from_subscription(sub_id)
        if email:
            customer_store.setdefault(email, {}).update({
                "status": "active",
                "last_payment": datetime.utcnow().isoformat(),
            })

    # ── Payment failed → flag account ─────────────────────────────────────
    elif event.type == "invoice.payment_failed":
        sub_id = obj.get("subscription", "")
        email  = _email_from_subscription(sub_id)
        if email:
            customer_store.setdefault(email, {})["status"] = "past_due"
            logger.warning("Payment failed for %s", email)

    # ── Subscription updated (plan change, billing cycle change) ──────────
    elif event.type == "customer.subscription.updated":
        sub_id = obj.get("id", "")
        email  = _email_from_subscription(sub_id)
        if email:
            # Determine new plan from price ID
            items   = obj.get("items", {}).get("data", [])
            price_id = items[0]["price"]["id"] if items else ""
            new_plan = _plan_from_price_id(price_id)
            status   = obj.get("status", "active")
            customer_store.setdefault(email, {}).update({
                "plan":   new_plan if new_plan != "free" else customer_store[email].get("plan", "pro"),
                "status": status,
            })
            logger.info("Subscription updated: %s status=%s plan=%s", email, status, new_plan)

    # ── Subscription cancelled / ended ─────────────────────────────────────
    elif event.type in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub_id = obj.get("id", "")
        email  = _email_from_subscription(sub_id)
        if email:
            customer_store.setdefault(email, {}).update({
                "plan":   "free",
                "status": "cancelled",
                "api_key": "",
            })
            logger.info("Subscription cancelled for %s", email)

    # ── Trial will end reminder (3 days before) ────────────────────────────
    elif event.type == "customer.subscription.trial_will_end":
        sub_id = obj.get("id", "")
        email  = _email_from_subscription(sub_id)
        logger.info("Trial ending soon for %s", email)
        # TODO: send email reminder

    return JSONResponse({"status": "ok", "event": event.type})


# ══════════════════════════════════════════════════════════════════════════
# Route 4: Subscription Status
# ══════════════════════════════════════════════════════════════════════════

@router.get("/subscription-status")
async def subscription_status(email: str):
    """Returns current plan, status and API key for a given email."""
    rec = customer_store.get(email, {})
    return {
        "email":           email,
        "plan":            rec.get("plan", "free"),
        "status":          rec.get("status", "free"),
        "api_key":         rec.get("api_key", ""),
        "subscription_id": rec.get("subscription_id", ""),
        "activated_at":    rec.get("activated_at", ""),
    }


# ══════════════════════════════════════════════════════════════════════════
# Route 5: Cancel Subscription
# ══════════════════════════════════════════════════════════════════════════

@router.post("/cancel-subscription")
async def cancel_subscription(req: CancelRequest):
    """Cancels the subscription at the end of the current billing period."""
    if not stripe.api_key or stripe.api_key.startswith("sk_test_XX"):
        raise HTTPException(status_code=503, detail="Stripe not configured.")

    rec = customer_store.get(req.email, {})
    sub_id = rec.get("subscription_id", "")
    if not sub_id:
        raise HTTPException(status_code=404, detail="No active subscription found for this email.")

    try:
        stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
        customer_store[req.email]["status"] = "cancelling"
        logger.info("Subscription set to cancel at period end: %s", req.email)
        return {"message": "Subscription will cancel at the end of the current billing period."}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=502, detail=str(e.user_message or e))


# ══════════════════════════════════════════════════════════════════════════
# Route 6: Price Listing (for frontend)
# ══════════════════════════════════════════════════════════════════════════

@router.get("/prices")
async def get_prices():
    """Returns the configured Stripe price IDs and amounts for the frontend."""
    return {
        "publishable_key": STRIPE_PUBLISHABLE_KEY,
        "plans": {
            "pro": {
                **PLAN_META["pro"],
                "price_ids": PRICE_IDS["pro"],
                "configured": bool(PRICE_IDS["pro"]["monthly"]),
            },
            "elite": {
                **PLAN_META["elite"],
                "price_ids": PRICE_IDS["elite"],
                "configured": bool(PRICE_IDS["elite"]["monthly"]),
            },
        },
        "stripe_configured": bool(stripe.api_key and not stripe.api_key.startswith("sk_test_XX")),
    }


# ══════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════

def _email_from_subscription(sub_id: str) -> Optional[str]:
    """Reverse-lookup email from subscription ID."""
    for email, rec in customer_store.items():
        if rec.get("subscription_id") == sub_id:
            return email
    # Try fetching from Stripe if not found locally
    if sub_id and stripe.api_key and not stripe.api_key.startswith("sk_test_XX"):
        try:
            sub  = stripe.Subscription.retrieve(sub_id, expand=["customer"])
            email = sub.customer.email
            if email:
                customer_store.setdefault(email, {})["subscription_id"] = sub_id
                return email
        except Exception:
            pass
    return None

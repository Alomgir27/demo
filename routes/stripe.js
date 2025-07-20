const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripeController');
const auth = require('../middleware/auth');

// Get pricing plans (public route)
router.get('/plans', stripeController.getPricingPlans);

// Create a checkout session (requires authentication)
router.post(
  '/create-checkout-session',
  auth.protect,
  stripeController.createCheckoutSession
);

// Get customer portal URL (requires authentication)
router.get(
  '/customer-portal',
  auth.protect,
  stripeController.getCustomerPortal
);

// Webhook endpoint for Stripe events
// This should not use standard auth as it comes from Stripe
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  stripeController.webhook
);

router.get(
  '/purchase-history',
  auth.protect,
  stripeController.getPurchaseHistory
);

// Verify payment after successful checkout
router.get(
  '/verify-payment/:sessionId',
  auth.protect,
  stripeController.verifyPayment
);

module.exports = router; 
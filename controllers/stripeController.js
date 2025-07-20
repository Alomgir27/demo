const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const Pricing = require('../models/Pricing');
const logger = require('../utils/logger');
const CreditTransaction = require('../models/creditTransection');

// Create checkout session
exports.createCheckoutSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { price } = req.body;

    // Input validation
    if (!userId) {
      return res.status(400).json({
        error: 'Authentication required',
        message: 'User authentication needed'
      });
    }

    if (!price || price < 1) {
      return res.status(400).json({
        error: 'Invalid price',
        message: 'Price is required and must be at least $1'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    // Get premium plan from database
    const premiumPlan = await Pricing.findOne({ name: 'premium' });
    if (!premiumPlan) {
      return res.status(404).json({
        error: 'Pricing plan not found',
        message: 'Premium plan configuration not found'
      });
    }

    // Calculate credits and discount
    const { credits, discountPercentage, finalPrice } = calculateCredits(price, premiumPlan);
    
    logger.info(`Credits calculation - Original: $${price}, Credits: ${credits}, Discount: ${discountPercentage}%, Final: $${finalPrice}`);

    // Handle Stripe customer
    const customerId = await handleStripeCustomer(user, userId);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${credits} Credits`,
            description: `${credits} processing minutes for audio separation`
          },
          unit_amount: Math.round(finalPrice * 100), // Convert to cents
        },
        quantity: 1,
      }],
      allow_promotion_codes: true,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing`,
      metadata: {
        userId: userId,
        credit: credits,
        price: finalPrice,
        originalPrice: price,
        discountPercentage: discountPercentage
      }
    });

    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
      credits: credits,
      price: finalPrice,
      discount: discountPercentage
    });

  } catch (error) {
    logger.error(`Stripe checkout error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      message: process.env.NODE_ENV === 'production'
        ? 'An error occurred while creating checkout session'
        : error.message
    });
  }
};

// Helper function to calculate credits and discount
function calculateCredits(price, premiumPlan) {
  let credits = 0;
  let discountPercentage = 0;
  let finalPrice = price;

  // Check if price matches any predefined pack
  const matchingPack = premiumPlan.pricing.creditPacks.find(pack => pack.price === price);
  
  if (matchingPack) {
    // Use predefined pack values
    credits = matchingPack.credits;
    discountPercentage = matchingPack.discountPercentage || 0;
    finalPrice = price * (1 - discountPercentage / 100);
  } else if (price > 180) {
    // For prices above 180, calculate based on 5000 credits for $180 (with 10% discount)
    const baseCredits = 5000;
    const basePrice = 180;
    const baseDiscount = 10;

    credits = Math.ceil((price * baseCredits) / basePrice);
    discountPercentage = baseDiscount;
    finalPrice = price * (1 - discountPercentage / 100);
  } else {
    // For custom prices, calculate based on base rate (25 credits per $1)
    credits = Math.ceil(price * 25);
    discountPercentage = 0;
    finalPrice = price;
  }

  return { credits, discountPercentage, finalPrice };
}

// Helper function to handle Stripe customer
async function handleStripeCustomer(user, userId) {
  let customerId = user.subscription?.stripeCustomerId;

  if (customerId) {
    // Verify existing customer
    try {
      await stripe.customers.retrieve(customerId);
      return customerId;
    } catch (error) {
      if (error.code === 'resource_missing') {
        // Customer was deleted, create a new one
        logger.info(`Stripe customer ${customerId} not found, creating new one`);
      } else {
        throw error;
      }
    }
  }

  // Create new customer
  const stripeCustomer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: {
      userId: user._id.toString()
    }
  });

  customerId = stripeCustomer.id;

  // Update user with new Stripe customer ID
  await User.findByIdAndUpdate(userId, {
    'subscription.stripeCustomerId': customerId
  });

  logger.info(`Created new Stripe customer ${customerId} for user ${userId}`);
  return customerId;
}

// Handle webhook from Stripe
exports.webhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  logger.info(`Received webhook with signature: ${sig ? 'present' : 'missing'}`);

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    logger.info(`Webhook event verified successfully: ${event.type}`);
  } catch (err) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  logger.info(`Processing webhook event: ${event.type} with ID: ${event.id}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        logger.info(`Processing checkout.session.completed for session: ${session.id}`);
        await handleCheckoutCompleted(session);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        await handlePaymentFailed(paymentIntent);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handleSubscriptionUpdated(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionStatusChange(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCanceled(subscription);
        break;
      }

      case 'customer.created': {
        const customer = event.data.object;
        logger.info(`Stripe customer created: ${customer.id}`);
        break;
      }

      default:
        logger.info(`Unhandled Stripe event: ${event.type}`);
    }

    logger.info(`Webhook event processed successfully: ${event.type}`);
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`Error handling webhook event: ${error.message}`);
    res.status(200).json({ received: true, error: error.message });
  }
};

// Get customer portal session
exports.getCustomerPortal = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find user
    const user = await User.findById(userId);
    if (!user || !user.subscription?.stripeCustomerId) {
      return res.status(404).json({
        error: 'Subscription not found',
        message: 'No active subscription found for this user'
      });
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: user.subscription.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/profile`,
    });

    res.status(200).json({
      success: true,
      url: session.url
    });
  } catch (error) {
    logger.error(`Customer portal error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      message: process.env.NODE_ENV === 'production'
        ? 'An error occurred while accessing the customer portal'
        : error.message
    });
  }
};

// Get pricing plans
exports.getPricingPlans = async (req, res) => {
  try {
    const plans = await Pricing.find({ isActive: true }).sort('displayOrder');

    if (!plans || plans.length === 0) {
      return res.status(404).json({
        error: 'No pricing plans found',
        message: 'No active pricing plans available'
      });
    }

    res.status(200).json({
      success: true,
      plans,
      count: plans.length
    });
  } catch (error) {
    logger.error(`Get pricing plans error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      message: process.env.NODE_ENV === 'production'
        ? 'An error occurred while retrieving pricing plans'
        : error.message
    });
  }
};

// purchase history
exports.getPurchaseHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all purchase transactions for this user, most recent first
    const transactions = await CreditTransaction.find({
      userId: userId,
      type: 'purchase'
    })
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: 'Purchase history retrieved successfully',
      transactions
    });
  } catch (error) {
    logger.error(`Error retrieving purchase history: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      details: error.message
    });
  }
};

// Verify payment and update user
exports.verifyPayment = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    if (!sessionId) {
      return res.status(400).json({
        error: 'Session ID required',
        message: 'Stripe session ID is required'
      });
    }

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return res.status(404).json({
        error: 'Session not found',
        message: 'Payment session not found'
      });
    }

    // Check if this session belongs to the current user
    if (session.metadata?.userId !== userId) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'This payment session does not belong to you'
      });
    }

    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        error: 'Payment not completed',
        message: 'Payment has not been completed successfully'
      });
    }

    // Check if we've already processed this session
    const existingTransaction = await CreditTransaction.findOne({
      stripeSessionId: sessionId,
      userId: userId
    });

    if (existingTransaction) {
      return res.status(200).json({
        success: true,
        message: 'Payment already processed',
        transaction: existingTransaction
      });
    }

    // Process the payment (same logic as webhook)
    const creditsToAdd = parseFloat(session.metadata?.credit);
    
    if (!creditsToAdd || isNaN(creditsToAdd)) {
      return res.status(400).json({
        error: 'Invalid credits',
        message: 'Invalid credits in payment session'
      });
    }

    // Update user credits and subscription type to premium
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        $inc: { credits: creditsToAdd },
        'subscription.type': 'premium',
        'subscription.status': 'active'
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User not found'
      });
    }

    // Create transaction record
    const transaction = await CreditTransaction.create({
      userId,
      type: 'purchase',
      credits: creditsToAdd,
      amount: session.amount_total / 100,
      stripeSessionId: sessionId,
      description: `Purchase of ${creditsToAdd} credits`,
      status: 'success'
    });

    logger.info(`Successfully processed payment verification for user ${userId}. Added ${creditsToAdd} credits`);

    res.status(200).json({
      success: true,
      message: 'Payment verified and processed successfully',
      transaction,
      user: {
        credits: updatedUser.credits,
        subscription: updatedUser.subscription
      }
    });

  } catch (error) {
    logger.error(`Payment verification error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      message: process.env.NODE_ENV === 'production'
        ? 'An error occurred while verifying payment'
        : error.message
    });
  }
};

// Helper functions for webhook handlers

// Handle checkout session completed event
async function handleCheckoutCompleted(session) {
  try {
    logger.info(`Processing checkout session: ${session.id}`);
    logger.info(`Session metadata: ${JSON.stringify(session.metadata)}`);
    
    const userId = session.metadata?.userId;
    const creditsToAdd = parseFloat(session.metadata?.credit);

    if (!userId) {
      logger.error(`Missing userId in session metadata for session: ${session.id}`);
      return;
    }

    if (!creditsToAdd || isNaN(creditsToAdd)) {
      logger.error(`Missing or invalid credits in session metadata for session: ${session.id}`);
      return;
    }

    logger.info(`Attempting to add ${creditsToAdd} credits to user: ${userId}`);

    // Update user credits and subscription type to premium
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        $inc: { credits: creditsToAdd },
        'subscription.type': 'premium',
        'subscription.status': 'active'
      },
      { new: true }
    );

    if (!updatedUser) {
      logger.error(`User not found: ${userId}`);
      return;
    }

    // Create transaction record
    await CreditTransaction.create({
      userId,
      type: 'purchase',
      credits: creditsToAdd,
      amount: session.amount_total / 100,
      stripeSessionId: session.id,
      description: `Purchase of ${creditsToAdd} credits`,
      status: 'success'
    });

    logger.info(`Successfully added ${creditsToAdd} credits to user ${userId}. New balance: ${updatedUser.credits}`);
    logger.info(`Updated subscription type to premium for user ${userId}`);

  } catch (error) {
    logger.error(`Error handling checkout completed: ${error.message}`);
    logger.error(`Error stack: ${error.stack}`);
    throw error;
  }
}

// Handle failed payment
async function handlePaymentFailed(paymentIntent) {
  try {
    const metadata = paymentIntent.metadata || {};
    const userId = metadata.userId;
    const amount = paymentIntent.amount ? paymentIntent.amount / 100 : 0;
    const stripeSessionId = metadata.sessionId || null;

    if (userId) {
      await CreditTransaction.create({
        userId: userId,
        type: 'purchase',
        credits: 0,
        amount: amount,
        description: 'Credit purchase failed via Stripe',
        stripeSessionId: stripeSessionId,
        status: 'failed'
      });

      logger.info(`Recorded failed credit purchase for user ${userId}, amount $${amount}`);
    }
  } catch (error) {
    logger.error(`Error handling payment failed: ${error.message}`);
  }
}

// Handle subscription updated
async function handleSubscriptionUpdated(invoice) {
  try {
    const customerId = invoice.customer;
    const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
    
    if (user) {
      user.subscription.status = 'active';
      await user.save();
      logger.info(`Updated subscription status for user ${user._id}`);
    }
  } catch (error) {
    logger.error(`Error handling subscription updated: ${error.message}`);
  }
}

// Handle subscription status change
async function handleSubscriptionStatusChange(subscription) {
  try {
    const customerId = subscription.customer;
    const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
    
    if (user) {
      user.subscription.status = subscription.status;
      user.subscription.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      await user.save();
      logger.info(`Updated subscription status to ${subscription.status} for user ${user._id}`);
    }
  } catch (error) {
    logger.error(`Error handling subscription status change: ${error.message}`);
  }
}

// Handle subscription canceled
async function handleSubscriptionCanceled(subscription) {
  try {
    const customerId = subscription.customer;
    const user = await User.findOne({ 'subscription.stripeCustomerId': customerId });
    
    if (user) {
      user.subscription.status = 'canceled';
      await user.save();
      logger.info(`Canceled subscription for user ${user._id}`);
    }
  } catch (error) {
    logger.error(`Error handling subscription canceled: ${error.message}`);
  }
}

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Authentication middleware
 */
const authMiddleware = {
  /**
   * Require authentication via API key
   */
  requireAuth: (req, res, next) => {
    try {
      // Extract API key from headers or query parameter
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;

      // Check if the API key is provided
      if (!apiKey) {
        return res.status(401).json({
          error: 'Authentication required',
          details: 'API key is missing'
        });
      }

      // Check if the API key is valid (compare with env variable)
      const validApiKey = process.env.API_KEY_SECRET;

      if (apiKey !== validApiKey) {
        logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 10)}...`);
        return res.status(401).json({
          error: 'Authentication failed',
          details: 'Invalid API key'
        });
      }

      // Store authentication status in request object
      req.isAuthenticated = true;

      // Continue to the next middleware
      next();
    } catch (error) {
      logger.error(`Authentication error: ${error.message}`);
      return res.status(500).json({
        error: 'Authentication error',
        details: 'An error occurred during authentication'
      });
    }
  },

  // Middleware to validate token and protect routes (for authenticated routes)
  protect: async (req, res, next) => {
    try {
      let token;

      // Check if token exists in headers
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }

      // Make sure token exists
      if (!token) {
        return res.status(401).json({
          error: 'Access denied',
          details: 'No authorization token provided'
        });
      }

      try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
      } catch (error) {
        return res.status(401).json({
          error: 'Access denied',
          details: 'Invalid token'
        });
      }
    } catch (error) {
      logger.error(`Auth middleware error: ${error.message}`);
      return res.status(500).json({
        error: 'Server error',
        details: 'Authentication failed'
      });
    }
  },

  // Middleware to add user if token exists (for mixed routes)
  addUserIfTokenExists: async (req, res, next) => {
    try {
      let token;
      
      // Check if token exists in headers
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }

      // If no token or null token, continue without user
      if (!token || token === 'null') {
        return next();
      }

      try {
        // Verify token and fetch user from database
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (!user) {
          return res.status(401).json({
            error: 'Access denied',
            details: 'User not found'
          });
        }
        
        req.user = user;
        next();
      } catch (error) {
        return res.status(401).json({
          error: 'Access denied',
          details: 'Invalid token'
        });
      }
    } catch (error) {
      logger.error(`Auth middleware error: ${error.message}`);
      return res.status(500).json({
        error: 'Server error',
        details: 'Authentication failed'
      });
    }
  },

  // Middleware to restrict access based on user role
  restrictTo: (...roles) => {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({
          error: 'Access denied',
          details: 'You do not have permission to perform this action'
        });
      }
      next();
    };
  },

  // Middleware to check if user has active subscription
  requireSubscription: async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      // Free tier is always allowed
      if (user.subscription.type === 'free') {
        return next();
      }

      // Check subscription status for premium users
      if (user.subscription.type === 'premium' && 
          user.subscription.status !== 'active' && 
          user.subscription.status !== 'trialing') {
        return res.status(403).json({
          error: 'Subscription required',
          details: 'Your subscription is not active'
        });
      }

      // Check if subscription period has ended
      if (user.subscription.currentPeriodEnd &&
          new Date(user.subscription.currentPeriodEnd) < new Date()) {
        return res.status(403).json({
          error: 'Subscription expired',
          details: 'Your subscription period has ended'
        });
      }

      next();
    } catch (error) {
      logger.error(`Subscription check error: ${error.message}`);
      return res.status(500).json({
        error: 'Server error',
        details: 'Failed to verify subscription'
      });
    }
  },

  // Verify JWT token
  authenticateToken: async (req, res, next) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        return res.status(401).json({ 
          error: 'Access token is required' 
        });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);

      if (!user) {
        return res.status(401).json({ 
          error: 'User not found' 
        });
      }

      req.user = user;
      next();
    } catch (error) {
      return res.status(403).json({ 
        error: 'Invalid token' 
      });
    }
  },

  // Optional authentication - allows authenticated users
  optionalAuth: async (req, res, next) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const user = await User.findById(decoded.id);
          if (user) {
            req.user = user;
          }
        } catch (error) {
          // Token invalid, continue without user
        }
      }

      next();
    } catch (error) {
      next();
    }
  },

  // Check if user can process file based on their limits
  checkProcessingLimits: async (req, res, next) => {
    try {
      // Get file duration from request
      let fileDurationSeconds = 0;
      
      if (req.body && req.body.fileDuration) {
        fileDurationSeconds = Number(req.body.fileDuration);
      } else if (req.headers && req.headers['x-file-info']) {
        try {
          const fileInfo = JSON.parse(req.headers['x-file-info']);
          if (fileInfo && fileInfo.duration) {
            fileDurationSeconds = Number(fileInfo.duration);
          }
        } catch (e) {
          // Continue without file info
        }
      }

      if (req.user) {
        // Authenticated user - check based on subscription type
        if (req.user.subscription.type === 'premium') {
          // Premium user - check credits
          const creditsNeeded = Math.ceil(fileDurationSeconds / 60); // 1 credit per minute
          if (req.user.credits < creditsNeeded) {
            return res.status(403).json({
              success: false,
              error: 'Insufficient credits',
              creditsNeeded,
              creditsAvailable: req.user.credits,
              requiresPurchase: true
            });
          }
        } else {
          // Free registered user - check free seconds limit
          const remainingSeconds = req.user.getRemainingFreeSeconds();
          if (remainingSeconds < fileDurationSeconds) {
            return res.status(403).json({
              success: false,
              error: 'Free time limit would be exceeded',
              secondsUsed: req.user.freeSecondsUsed,
              secondsLimit: req.user.freeSecondsLimit,
              remainingSeconds,
              fileDurationSeconds,
              requiresUpgrade: true
            });
          }
        }
      }
      // Unauthenticated users are not allowed

      next();
    } catch (error) {
      next(error);
    }
  },

  // Update user usage after successful processing
  updateUserUsage: async (req, res, next) => {
    try {
      if (req.user && req.separation) {
        const fileDurationSeconds = req.separation.fileDuration || 0;
        
        if (req.user.subscription.type === 'premium') {
          // Deduct credits for premium users
          const creditsUsed = Math.ceil(fileDurationSeconds / 60);
          req.user.credits = Math.max(0, req.user.credits - creditsUsed);
          
          // Log credit transaction
          const CreditTransaction = require('../models/creditTransection');
          await new CreditTransaction({
            userId: req.user._id,
            type: 'usage',
            credits: -creditsUsed,
            description: `Audio separation: ${req.separation.originalFilename}`
          }).save();
        } else {
          // Update free seconds used for free users
          req.user.freeSecondsUsed += fileDurationSeconds;
        }
        
        await req.user.save();
      }
      
      next();
    } catch (error) {
      next(error);
    }
  }
};

module.exports = authMiddleware; 
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { sendResetPasswordEmail, sendVerifyEmail } = require('../utils/emailHelper');

// Helper to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

function generateUrlSafeToken(byteLength = 16) {
  return crypto.randomBytes(byteLength)
    .toString('base64')
    .replace(/\+/g, '-')  // Replace '+' with '-'
    .replace(/\//g, '_')  // Replace '/' with '_'
    .replace(/=+$/, '');  // Remove '=' padding
}

const calculateRemainingSeconds = (user) => {
  let remainingSeconds;
  if (user.subscription.type === 'premium') {
    remainingSeconds = user.credits * 60.0;
  } else {
    remainingSeconds = user.getRemainingFreeSeconds();
  }
  return remainingSeconds;
}
// Register new user
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Input validation
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'Name, email, and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Invalid password',
        details: 'Password must be at least 6 characters long'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format',
        details: 'Please provide a valid email address'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        error: 'Email already in use',
        details: 'A user with this email already exists'
      });
    }

    const verificationToken = generateUrlSafeToken();
    
    // Create new user with fallback for missing FREE_USER_CREDITS
    const freeCredits = process.env.FREE_USER_CREDITS || 12;
    
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      credits: parseInt(freeCredits),
      emailVerificationToken: verificationToken,
      isEmailVerified: false
    });

    // Save user first
    await user.save();

    // Create user object without sensitive data
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.emailVerificationToken;

    // Send verification email in background (non-blocking)
    setImmediate(async () => {
      try {
        await sendVerifyEmail(user, verificationToken);
        logger.info(`Verification email sent to: ${user.email}`);
      } catch (emailError) {
        logger.error(`Failed to send verification email: ${emailError.message}`);
        // Could implement retry logic here or queue for later
      }
    });

    // Return success immediately without waiting for email
    res.status(201).json({
      message: 'User registered successfully. Please check your email to verify your account.',
      user: userObj
    });
  } catch (error) {
    logger.error(`Registration error: ${error.message}`);
    logger.error(`Registration error stack: ${error.stack}`);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      return res.status(400).json({
        error: 'Email already exists',
        details: 'This email is already registered'
      });
    }

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        error: 'Validation error',
        details: validationErrors.join(', ')
      });
    }

    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'production'
        ? 'An error occurred during registration'
        : error.message
    });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user and include password field for verification
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        error: 'Authentication failed',
        details: 'Invalid email or password'
      });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Authentication failed',
        details: 'Invalid email or password'
      });
    }

    if (!user.isEmailVerified) {
      return res.status(401).json({
        error: 'Email not verified',
        details: 'Please verify your email to login'
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    // Remove password from response
    const userObj = user.toObject();
    delete userObj.password;

    // Calculate remaining seconds based on user type
    let remainingSeconds = calculateRemainingSeconds(user);

    res.status(200).json({
      message: 'Login successful',
      user: userObj,
      token,
      remainingSeconds
    });
  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'production'
        ? 'An error occurred during login'
        : error.message
    });
  }
};

// Google authentication callback
exports.googleCallback = async (req, res) => {
  try {
    // The user should already be authenticated by Passport
    if (!req.user) {
      return res.status(500).json({
        error: 'Authentication failed',
        details: 'Google authentication failed'
      });
    }

    // Generate JWT token
    const token = generateToken(req.user);
    // Redirect to frontend with token
    // In production, you might want to use a more secure approach
    res.redirect(`${process.env.FRONTEND_URL}/auth/google/callback?token=${token}`);
  } catch (error) {
    logger.error(`Google auth callback error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      details: 'Google authentication failed'
    });
  }
};

// Get current user's profile
exports.getProfile = async (req, res) => {
  try {
    // User should be available from auth middleware
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        details: 'User no longer exists'
      });
    }

    // Now, remainingSeconds is just the user's credits
    // Calculate remaining seconds based on user type
    let remainingSeconds = calculateRemainingSeconds(user);

    res.status(200).json({
      message: 'Profile retrieved successfully',
      user,
      remainingSeconds, // This is now the credits
    });
  } catch (error) {
    logger.error(`Get profile error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'production'
        ? 'An error occurred while retrieving profile'
        : error.message
    });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    // Find and update user
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { name, email, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        error: 'User not found',
        details: 'User no longer exists'
      });
    }

    // Calculate remaining seconds based on user type
    let remainingSeconds = calculateRemainingSeconds(updatedUser);

    res.status(200).json({
      message: 'Profile updated successfully',
      user: updatedUser,
      remainingSeconds
    });
  } catch (error) {
    logger.error(`Update profile error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'production'
        ? 'An error occurred while updating profile'
        : error.message
    });
  }
};

// Request password reset
exports.requestPasswordReset = async (req, res) => {

  try {
    const { email } = req.body;

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        details: 'User with this email does not exist'
      })
    }

    const resetToken = generateUrlSafeToken();
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = Date.now() + parseInt(process.env.RESET_PASSWORD_EXPIRES);

    await user.save();
    try {
      await sendResetPasswordEmail(user, resetToken);
      return res.status(200).json({
        message: 'Password reset email sent successfully',
        details: 'Please check your email for reset instructions',
        email: email
      });
    } catch (error) {

      user.resetPasswordToken = undefined;
      user.resetPasswordExpiry = undefined;
      await user.save();

      return res.status(500).json({
        error: 'Email error',
        details: 'There was an error sending the reset email',
        email: email
      })
    }

  } catch (error) {
    logger.error(`Forgot password error: ${error.message}`);
    return res.status(500).json({
      error: 'Server error',
      details: 'An error occurred while processing the forgot password request',
    })
  }
};

exports.resetPasswordTokenCheck = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() }
    })

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired token',
        details: 'Password reset token is invalid or expired'
      })
    }

    res.status(200).json({
      message: 'Token is valid',
      email: user.email
    })

  } catch (error) {
    logger.error(`Reset password token check error: ${error.message}`);
    return res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV == 'production'
        ? 'An error occured while checking reset token'
        : error.message
    })
  }
}
// Reset password with token
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() }
    })

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired token',
        details: 'Password reset token is invalid or expired'
      })
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;

    await user.save();

    const loginToken = generateToken(user);
    const remainingSeconds = calculateRemainingSeconds(user);

    res.status(200).json({
      message: 'Password reset successful',
      token: loginToken,
      user: user.toObject(),
      remainingSeconds
    })

  } catch (error) {
    logger.error(`Reset password error: ${error.message}`);
    return res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'production'
        ? 'An error occurred while resetting password'
        : error.message
    })
  }
}

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        error: 'Missing token',
        details: 'Verification token is required'
      });
    }

    const user = await User.findOne({
      emailVerificationToken: token,
    });

    if (!user) {
      return res.status(400).json({
        error: 'Invalid token',
        details: 'Email verification token is invalid '
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;

    await user.save();

    // const loginToken = generateToken(user);

    const remainingSeconds = calculateRemainingSeconds(user);

    return res.status(200).json({
      message: 'Email verified successfully please login to continue',
      // token: loginToken,
      // user: user.toObject(),
      remainingSeconds
    })
  } catch (error) {
    logger.error(`Email verification error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'production'
        ? 'An error occurred during email verification'
        : error.message
    });
  }
}

exports.resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email }).select('+emailVerificationExpiry +emailVerificationToken +verificationAttempts');
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        details: 'User with this email does not exist'
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        error: 'Email already verified',
        details: 'User with this email is already verified'
      });
    }

    if (user.emailVerificationExpiry) {
      const timeElapsed = Date.now() - new Date(user.emailVerificationExpiry).getTime() + parseInt(process.env.EMAIL_VERIFICATION_EXPIRES);
      logger.info(`Time elapsed since last verification email: ${timeElapsed}ms`);

      if (timeElapsed < 5 * 60 * 1000) {
        const waitTime = Math.ceil((5 * 60 * 1000 - timeElapsed) / 1000);
        return res.status(429).json({
          error: 'Too many requests',
          details: `Please wait ${waitTime} seconds before requesting another email`,
          retryAfter: waitTime // seconds
        });
      }
    }

    if (!user.verificationAttempts) {
      user.verificationAttempts = 0;
    }
    user.verificationAttempts += 1;

    if (user.verificationAttempts > 5) {
      return res.status(400).json({
        error: 'Too many verification attempts',
        details: 'Please contact support to verify your account',
        requiresSupport: true
      });
    }

    const verificationToken = generateUrlSafeToken();
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpiry = Date.now() + parseInt(process.env.EMAIL_VERIFICATION_EXPIRES);

    await user.save();

    await sendVerifyEmail(user, verificationToken);
    res.status(200).json({
      message: 'Verification email sent successfully',
      details: 'Please check your email for verification instructions'
    });

  } catch (error) {
    logger.error(`Resend verification email error: ${error.message}`);
    res.status(500).json({
      error: 'Server error',
      details: process.env.NODE_ENV === 'production'
        ? 'An error occurred while resending verification email'
        : error.message
    });
  }
}
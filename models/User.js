const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    // Not required because of Google Auth
    select: false // Don't return password by default
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String,
    select: false // Don't return this field by default
  },
  emailVerificationExpiry: {
    type: Date,
    select: false // Don't return this field by default
  },
  verificationAttempts: {
    type: Number,
    default: 0
  },
  credits: {
    type: Number,
    default: 0
  },
  // Free usage tracking for registered users
  freeSecondsUsed: {
    type: Number,
    default: 0
  },
  freeSecondsLimit: {
    type: Number,
    default: 1500 // 25 minutes for registered users
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // Allow null/undefined values
  },
  profilePicture: {
    type: String
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  subscription: {
    type: {
      type: String,
      enum: ['free', 'premium', 'pro'],
      default: 'free'
    },
    status: {
      type: String,
      enum: ['active', 'trialing', 'past_due', 'canceled', 'none'],
      default: 'none'
    },
    stripeCustomerId: {
      type: String
    },
    stripeSubscriptionId: {
      type: String
    },
    currentPeriodEnd: {
      type: Date
    },
    secondsUsed: {
      type: Number,
      default: 0 // total seconds used
    }
  },
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpiry: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Get remaining free seconds
UserSchema.methods.getRemainingFreeSeconds = function () {
  return Math.max(0, this.freeSecondsLimit - this.freeSecondsUsed);
};

// Check if user can process file
UserSchema.methods.canProcessFile = function (fileDurationSeconds) {
  if (this.subscription.type === 'premium') {
    // Premium users need credits
    return this.credits >= Math.ceil(fileDurationSeconds / 60); // 1 credit per minute
  } else {
    // Free users need remaining seconds
    return this.getRemainingFreeSeconds() >= fileDurationSeconds;
  }
};

const User = mongoose.model('User', UserSchema);

module.exports = User; 
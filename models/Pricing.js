const mongoose = require('mongoose');

const PricingSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    enum: ['free', 'premium', 'pro', 'registered'],
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  features: [{
    type: String,
    required: true
  }],
  isFree: {
    type: Boolean,
    default: false
  },
  freeCreditGift: {
    type: Number
  },
  creditBased: {
    type: Boolean,
    default: false
  },
  creditsPerMinute: {
    type: Number
  },
  pricing: {
    creditPacks: [{
      credits: Number,
      price: Number,
      discountPercentage: Number
    }],
    basePackage: {
      price: Number,
      credits: Number
    },
    customCredits: {
      minPrice: Number,
      minCredits: Number,
      pricePerCredit: Number
    }
  },
  stripePriceIds: {
    monthly: {
      type: String
    },
    yearly: {
      type: String
    },
    creditPack25: String,
    creditPack250: String,
    creditPack625: String,
    creditPack1250: String,
    creditPack2500: String,
    creditPack5000: String,
    customCredits: String
  },
  limits: {
    uploadsPerDay: {
      type: Number
    },
    maxFileSize: {
      type: Number // in MB
    },
    maxDuration: {
      type: Number // in minutes
    },
    maxConcurrentJobs: {
      type: Number
    },
    requiresCaptcha: {
      type: Boolean,
      default: false
    },
    showsAds: {
      type: Boolean,
      default: false
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high']
    },
    hasLimitedApiAccess: {
      type: Boolean,
      default: false
    },
    batchProcessing: {
      type: Boolean,
      default: false
    },
    fullApiAccess: {
      type: Boolean,
      default: false
    }
  },
  outputFormats: [{
    type: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    required: true
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

const Pricing = mongoose.model('Pricing', PricingSchema);

module.exports = Pricing; 
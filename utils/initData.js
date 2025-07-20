const Pricing = require('../models/Pricing');
const logger = require('./logger');

/**
 * Initialize pricing plans data if not already present in the database
 */
async function initPricingPlans() {
  try {
    // Check if we already have pricing plans
    const existingPlans = await Pricing.countDocuments();

    if (existingPlans > 0) {
      logger.info('Pricing plans already exist, skipping initialization');
      return;
    }

    const pricingPlans = [

      {
        name: 'registered',
        description: 'Ideal for regular users who need more processing time and better features',
        features: [
          '25 minutes of total processing time',
          'High-quality audio output',
          'Extended file format support (MP3, WAV, FLAC, M4A)',
          'Priority email support',
          'No ads',
          'Batch processing (up to 3 files)',
          'Processing history and management'
        ],
        isFree: true,
        freeCreditGift: 0,
        creditBased: false,
        limits: {
          maxDuration: 25, // 25 minutes total
          maxFileSize: 250, // 250MB
          maxConcurrentJobs: 2,
          requiresCaptcha: false,
          showsAds: false,
          priority: 'medium',
          batchProcessing: true
        },
        outputFormats: ['mp3', 'wav', 'flac', 'm4a'],
        isActive: true,
        displayOrder: 2
      },
      {
        name: 'starter',
        description: 'Perfect for users who need more than free but not full premium',
        features: [
          '500 credits (≈ 8+ hours processing)',
          'Premium audio quality',
          'Priority processing queue',
          'Credits never expire',
          'All file formats supported',
          'Email support'
        ],
        isFree: false,
        creditBased: true,
        creditsPerMinute: 1,
        pricing: {
          basePackage: {
            price: 20.00,
            credits: 500
          }
        },
        stripePriceIds: {
          basePackage: 'price_starter_20_credits'
        },
        limits: {
          maxFileSize: 500,
          maxConcurrentJobs: 3,
          requiresCaptcha: false,
          showsAds: false,
          priority: 'high',
          batchProcessing: true,
          fullApiAccess: true
        },
        outputFormats: ['mp3', 'wav', 'flac', 'm4a', 'aac'],
        isActive: true,
        displayOrder: 4
      },
      {
        name: 'premium',
        description: 'Best for professionals and heavy users with unlimited access and premium features',
        features: [
          'Pay-per-use credit system (1 credit = 1 minute)',
          'Premium audio quality with AI enhancement',
          'All file formats supported',
          'Priority processing queue',
          '24/7 priority support',
          'Advanced AI models and separation algorithms',
          'API access for automation',
          'Custom output formats and settings',
          'Credits never expire',
          'Bulk processing discounts'
        ],
        isFree: false,
        creditBased: true,
        creditsPerMinute: 1,
        pricing: {
          creditPacks: [
            {
              credits: 25,
              price: 1.00,
              discountPercentage: 0
            },
            {
              credits: 250,
              price: 9.00,
              discountPercentage: 10
            },
            {
              credits: 500,
              price: 20.00,
              discountPercentage: 0
            },
            {
              credits: 625,
              price: 20.00,
              discountPercentage: 20
            },
            {
              credits: 1250,
              price: 37.50,
              discountPercentage: 25
            },
            {
              credits: 2500,
              price: 70.00,
              discountPercentage: 30
            },
            {
              credits: 5000,
              price: 130.00,
              discountPercentage: 35
            }
          ],
          basePackage: {
            price: 1.00,
            credits: 25
          },
          customCredits: {
            minPrice: 100.00,
            minCredits: 2500,
            pricePerCredit: 0.04
          }
        },
        stripePriceIds: {
          creditPack25: 'price_premium_25_credits',
          creditPack250: 'price_premium_250_credits',
          creditPack500: 'price_premium_500_credits',
          creditPack625: 'price_premium_625_credits',
          creditPack1250: 'price_premium_1250_credits',
          creditPack2500: 'price_premium_2500_credits',
          creditPack5000: 'price_premium_5000_credits',
          customCredits: 'price_premium_custom_credits'
        },
        limits: {
          maxFileSize: 1000, // 1GB
          maxConcurrentJobs: 10,
          requiresCaptcha: false,
          showsAds: false,
          priority: 'high',
          hasLimitedApiAccess: false,
          batchProcessing: true,
          fullApiAccess: true
        },
        outputFormats: ['mp3', 'wav', 'flac', 'm4a', 'aiff', 'ogg'],
        isActive: true,
        displayOrder: 3
      }
    ];

    // Insert plans using upsert to handle potential duplicates
    for (const plan of pricingPlans) {
      try {
        await Pricing.findOneAndUpdate(
          { name: plan.name },
          plan,
          { 
            upsert: true, 
            new: true,
            setDefaultsOnInsert: true 
          }
        );
        logger.info(`Upserted pricing plan: ${plan.name}`);
      } catch (error) {
        if (error.code === 11000) {
          // Handle duplicate key error by trying to update existing document
          logger.warn(`Pricing plan '${plan.name}' already exists, skipping`);
        } else {
          throw error;
        }
      }
    }

    logger.info('Successfully initialized pricing plans');
  } catch (error) {
    logger.error(`Error initializing pricing plans: ${error.message}`);
  }
}

module.exports = {
  initPricingPlans
}; 
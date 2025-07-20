const Separation = require("../models/separation");
const smartQueueService = require("../services/smartQueueService");
const fileHelper = require("../utils/fileHelper");
const logger = require("../utils/logger");
const User = require("../models/User");
const CreditTransaction = require("../models/creditTransection");

// Helper function to clean uploads folder
async function cleanUploadsFolder() {
  try {
    const maintenance = require("../utils/maintenance");
    if (maintenance && typeof maintenance.cleanUploadsFolder === 'function') {
      const results = await maintenance.cleanUploadsFolder();
      logger.info(`Cleaned uploads folder: Deleted ${results.deletedCount} files`);
    }
  } catch (error) {
    logger.error(`Error cleaning uploads folder: ${error.message}`);
  }
}

// File upload and add to queue
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded",
        status: "FAILED"
      });
    }

    // Check user limits before processing
    const fileDurationSeconds = req.body.fileDuration ? Math.floor(Number(req.body.fileDuration)) : 0;

    // Helper function to format duration for messages
    const formatDurationMessage = (seconds) => {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ${remainingSeconds > 0 ? `${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}` : ''}`.trim();
      }
      return `${seconds} second${seconds > 1 ? 's' : ''}`;
    };

    if (fileDurationSeconds <= 0) {
      return res.status(400).json({
        error: "Could not determine file duration",
        message: "Please ensure your file is a valid audio or video file with duration information.",
        status: "FAILED"
      });
    }

    if (req.user) {
      // Authenticated user - check limits
      if (req.user.subscription.type === 'premium') {
        // Premium user - check credits
        const creditsNeeded = (fileDurationSeconds / 60.0);
        if (req.user.credits < creditsNeeded) {
          return res.status(403).json({
            error: "Insufficient credits for this file",
            message: `This ${formatDurationMessage(fileDurationSeconds)} file requires ${creditsNeeded} credit${creditsNeeded > 1 ? 's' : ''}, but you only have ${req.user.credits} credit${req.user.credits !== 1 ? 's' : ''} remaining. Please purchase more credits to continue.`,
            creditsNeeded,
            creditsAvailable: req.user.credits,
            fileDuration: fileDurationSeconds,
            requiresPurchase: true,
            status: "FAILED"
          });
        }
      } else {
        // Free registered user - check time limit
        const remainingSeconds = req.user.getRemainingFreeSeconds();
        if (remainingSeconds < fileDurationSeconds) {
          return res.status(403).json({
            error: "Free plan duration limit exceeded",
            message: `This ${formatDurationMessage(fileDurationSeconds)} file would exceed your free plan limit. You have ${formatDurationMessage(remainingSeconds)} remaining out of ${formatDurationMessage(req.user.freeSecondsLimit)} total. Please upgrade to Premium for unlimited processing.`,
            secondsUsed: req.user.freeSecondsUsed,
            secondsLimit: req.user.freeSecondsLimit,
            remainingSeconds,
            fileDuration: fileDurationSeconds,
            requiresUpgrade: true,
            status: "FAILED"
          });
        }
      }
    } else {
      // Require authentication for file processing
      return res.status(401).json({
        error: "Authentication required",
        message: "Please sign up or log in to process audio files.",
        requiresAuthentication: true,
        status: "FAILED"
      });
    }

    // Step 1: Upload to R2 bucket first
    const fileInfo = await fileHelper.saveFile(req.file);

    // Create separation record with complete data
    const separation = new Separation({
      originalFilename: req.file.originalname,
      storedFilename: req.file.filename || `${Date.now()}-${req.file.originalname}`,
      fileSize: req.file.size,
      fileDuration: fileDurationSeconds,
      filePath: fileInfo.filePath,
      publicUrl: fileInfo.publicUrl,
      storageType: "file",
      r2Key: fileInfo.r2Key,
      status: "UPLOADED",
      userId: req.user?._id || null
    });
    await separation.save();

    // Step 2: Add to queue
    const jobData = {
      separationId: separation._id,
      filePath: fileInfo.publicUrl,
      storageType: "file",
      originalFilename: fileInfo.originalFilename,
      fileSize: fileInfo.fileSize,
      userId: req.user?.id || null,
    };

    await smartQueueService.addJob(jobData);

    // Update status to QUEUED
    separation.status = "QUEUED";
    await separation.save();

    res.json({
      separationId: separation._id,
      status: separation.status,
      originalFilename: separation.originalFilename
    });

  } catch (error) {
    logger.error(`Upload error: ${error.message}`);
    res.status(500).json({
      error: "Upload failed",
      status: "FAILED"
    });
  }
};

// Process from URL
exports.processUrl = async (req, res) => {
  try {
    const { url, fileDuration } = req.body;
    const fileDurationSeconds = fileDuration ? Math.floor(Number(fileDuration)) : 0;

    if (!url) {
      return res.status(400).json({
        error: "URL is required",
        status: "FAILED"
      });
    }

    // Step 1: Validate URL
    try {
      new URL(url.trim());
    } catch (urlError) {
      return res.status(400).json({
        error: "Invalid URL format",
        status: "FAILED"
      });
    }

    // Extract filename from URL
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const originalFilename = pathname.substring(pathname.lastIndexOf("/") + 1) || "URL Audio";

    // Helper function to format duration for messages (same as upload)
    const formatDurationMessage = (seconds) => {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ${remainingSeconds > 0 ? `${remainingSeconds} second${remainingSeconds > 1 ? 's' : ''}` : ''}`.trim();
      }
      return `${seconds} second${seconds > 1 ? 's' : ''}`;
    };

          // Check user limits
    if (fileDurationSeconds > 0) {
      if (req.user) {
        // Authenticated user - check limits
        if (req.user.subscription.type === 'premium') {
          // Premium user - check credits
          const creditsNeeded = (fileDurationSeconds / 60.0);
          if (req.user.credits < creditsNeeded) {
            return res.status(403).json({
              error: "Insufficient credits for this URL",
              message: `This ${formatDurationMessage(fileDurationSeconds)} audio/video requires ${creditsNeeded} credit${creditsNeeded > 1 ? 's' : ''}, but you only have ${req.user.credits} credit${req.user.credits !== 1 ? 's' : ''} remaining. Please purchase more credits to continue.`,
              creditsNeeded,
              creditsAvailable: req.user.credits,
              fileDuration: fileDurationSeconds,
              requiresPurchase: true,
              status: "FAILED"
            });
          }
        } else {
          // Free registered user - check time limit
          const remainingSeconds = req.user.getRemainingFreeSeconds();
          if (remainingSeconds < fileDurationSeconds) {
            return res.status(403).json({
              error: "Free plan duration limit exceeded",
              message: `This ${formatDurationMessage(fileDurationSeconds)} audio/video would exceed your free plan limit. You have ${formatDurationMessage(remainingSeconds)} remaining out of ${formatDurationMessage(req.user.freeSecondsLimit)} total. Please upgrade to Premium for unlimited processing.`,
              secondsUsed: req.user.freeSecondsUsed,
              secondsLimit: req.user.freeSecondsLimit,
              remainingSeconds,
              fileDuration: fileDurationSeconds,
              requiresUpgrade: true,
              status: "FAILED"
            });
          }
        }
      } else {
        // Require authentication for URL processing
        return res.status(401).json({
          error: "Authentication required",
          message: "Please sign up or log in to process audio/video URLs.",
          requiresAuthentication: true,
          status: "FAILED"
        });
      }
    }

    // Create separation record for URL
    const separation = new Separation({
      originalFilename: originalFilename,
      storedFilename: originalFilename,
      fileSize: 0,
      fileDuration: fileDurationSeconds,
      filePath: url,
      publicUrl: url,
      storageType: "url",
      status: "VALIDATING",
      userId: req.user?._id || null
    });
    await separation.save();

    // Small delay for UI smoothness
    await new Promise(resolve => setTimeout(resolve, 600));

    // Step 2: Update to validated
    separation.status = "VALIDATED";
    await separation.save();

    // Step 3: Add to queue
    const jobData = {
      separationId: separation._id,
      filePath: url,
      storageType: "url",
      originalFilename: originalFilename,
      fileSize: null,
      userId: req.user?.id || null,
    };

    await smartQueueService.addJob(jobData);

    // Small delay for UI smoothness
    await new Promise(resolve => setTimeout(resolve, 500));

    // Update status to QUEUED
    separation.status = "QUEUED";
    await separation.save();

    res.json({
      separationId: separation._id,
      status: separation.status,
      originalFilename: separation.originalFilename,
      fileDuration: separation.fileDuration,
      message: "URL validated and queued for processing"
    });

  } catch (error) {
    logger.error(`URL process error: ${error.message}`);
    res.status(500).json({
      error: "URL processing failed",
      status: "FAILED"
    });
  }
};

// Get separation status
exports.getStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const separation = await Separation.findById(id);

    if (!separation) {
      return res.status(404).json({
        error: "Separation not found",
        status: "FAILED"
      });
    }

    const response = {
      separationId: separation._id,
      status: separation.status,
      originalFilename: separation.originalFilename
    };

    // Get queue status if still in queue
    if (separation.status === "QUEUED") {
      try {
        const queueStatus = await smartQueueService.getJobStatus(id);
        if (queueStatus && queueStatus.queuePosition) {
          response.queuePosition = queueStatus.queuePosition;
          response.estimatedWaitMinutes = queueStatus.estimatedWaitMinutes;
        }
      } catch (queueError) {
        // Continue without queue info if error
      }
    }

    // Add download URLs if completed and handle credit/time deduction
    if (separation.status === "COMPLETE" && !separation.creditsDeducted) {
      response.vocalUrl = separation.vocalUrl;
      response.instrumentalUrl = separation.instrumentalUrl;

      // Handle registered users
      if (req.user && separation.userId && separation.userId.equals(req.user._id)) {
        if (separation.fileDuration > 0) {
          if (req.user.subscription.type === 'premium') {
            const creditsUsed = (separation.fileDuration / 60.0);
            req.user.credits = Math.max(0, req.user.credits - creditsUsed);

            await new CreditTransaction({
              userId: req.user._id,
              type: 'usage',
              credits: -creditsUsed,
              description: `Audio separation: ${separation.originalFilename}`,
              status: 'success'
            }).save();

            logger.info(`Premium user ${req.user._id} used ${creditsUsed} credits for separation ${separation._id}, remaining: ${req.user.credits}`);
          } else {
            req.user.freeSecondsUsed += separation.fileDuration;
            logger.info(`Free user ${req.user._id} used ${separation.fileDuration}s for separation ${separation._id}, total used: ${req.user.freeSecondsUsed}s`);
          }
          await req.user.save();
        }
      }


      // Mark credits as deducted to prevent double-charging
      separation.creditsDeducted = true;
      await separation.save();
    } else if (separation.status === "COMPLETE") {
      // If already complete and credits deducted, just add URLs
      response.vocalUrl = separation.vocalUrl;
      response.instrumentalUrl = separation.instrumentalUrl;
    }

    // Add error message if failed
    if (separation.status === "FAILED") {
      response.error = separation.errorMessage;
    }

    res.json(response);

  } catch (error) {
    logger.error(`Status check error: ${error.message}`);
    res.status(500).json({
      error: "Status check failed",
      status: "FAILED"
    });
  }
};



// Get user quota status
exports.getUserQuota = async (req, res) => {
  try {
    if (req.user) {
      // Authenticated user
      const user = req.user;

      if (user.subscription && user.subscription.type === 'premium') {
        // Premium user - return credit information
        return res.json({
          userType: 'premium',
          credits: user.credits || 0,
          unlimited: true,
          costPerMinute: 1, // 1 credit per minute
          message: 'Premium user with credit-based usage'
        });
      } else {
        // Free registered user
        const used = user.freeSecondsUsed || 0;
        const limit = user.freeSecondsLimit || 1500;
        const remaining = Math.max(0, limit - used);

        return res.json({
          userType: 'registered',
          secondsUsed: used,
          secondsLimit: limit,
          secondsRemaining: remaining,
          minutesUsed: Math.floor(used / 60),
          minutesLimit: Math.floor(limit / 60),
          minutesRemaining: Math.floor(remaining / 60),
          percentUsed: Math.min(100, Math.round((used / limit) * 100)),
          message: `Registered user: ${Math.floor(remaining / 60)} minutes remaining`
        });
      }
    } else {
      // Require authentication for quota checking
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please sign up or log in to check your quota.',
        requiresAuthentication: true
      });
    }
  } catch (error) {
    logger.error(`Error getting user quota: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    res.status(500).json({
      error: 'Failed to get quota information',
      message: error.message,
      status: 'FAILED'
    });
  }
}; 
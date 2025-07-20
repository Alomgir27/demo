const logger = require('./logger');
const Separation = require('../models/separation');

/**
 * Helper function to check RunPod status and update separation record
 * @param {object} runpodService - The RunPod service instance
 * @param {string} runpodJobId - RunPod job ID to check
 * @param {object} separation - Separation record to update
 * @returns {object} - Status result from RunPod
 */
async function checkAndUpdateRunpodStatus(runpodService, runpodJobId, separation) {
  try {
    // Check status with RunPod API
    const statusResult = await runpodService.checkStatus(runpodJobId);
    
    logger.info(`RunPod job ${runpodJobId} status: ${statusResult.status}`);
    
    // Update separation record based on status
    if (statusResult.status === 'COMPLETED') {
      if (statusResult.output?.processing_status === 'COMPLETED') {
        // Job completed successfully
        separation.status = 'COMPLETED';
        separation.vocalUrl = statusResult.output.vocal_audio;
        separation.instrumentalUrl = statusResult.output.instrument_audio;
        separation.executionTime = statusResult.executionTime;
        separation.delayTime = statusResult.delayTime;
        separation.processingMessage = 'Processing completed successfully';
        await separation.save();
      } else if (statusResult.output?.processing_status === 'FAILED') {
        // Job completed but with processing error
        separation.status = 'FAILED';
        separation.errorMessage = statusResult.output.failed_reason || 'Unknown processing error';
        separation.executionTime = statusResult.executionTime;
        separation.delayTime = statusResult.delayTime;
        await separation.save();
      }
    } else if (statusResult.status === 'FAILED') {
      // Job failed
      separation.status = 'FAILED';
      separation.errorMessage = statusResult.error || 'RunPod job failed';
      separation.executionTime = statusResult.executionTime;
      separation.delayTime = statusResult.delayTime;
      await separation.save();
      
      logger.error(`Separation ${separation._id} failed with RunPod job ${runpodJobId}: ${separation.errorMessage}`);
    } else if (statusResult.status === 'IN_PROGRESS') {
      // Job in progress, update processing message
      separation.status = 'PROCESSING';
      separation.processingMessage = `RunPod processing: IN_PROGRESS`;
      separation.delayTime = statusResult.delayTime;
      await separation.save();
      
      logger.info(`Separation ${separation._id} is IN_PROGRESS with RunPod job ${runpodJobId}`);
    } else if (statusResult.status === 'IN_QUEUE') {
      // Job still in queue, update processing message
      separation.status = 'PENDING';
      separation.processingMessage = `RunPod status: IN_QUEUE`;
      separation.delayTime = statusResult.delayTime;
      await separation.save();
      
      logger.info(`Separation ${separation._id} is IN_QUEUE with RunPod job ${runpodJobId}`);
    } else {
      // Unknown status, update processing message
      separation.processingMessage = `RunPod status: ${statusResult.status}`;
      separation.delayTime = statusResult.delayTime;
      await separation.save();
      
      logger.warn(`Separation ${separation._id} has unknown RunPod status: ${statusResult.status}`);
    }
    
    return statusResult;
  } catch (error) {
    logger.error(`Error checking RunPod status for job ${runpodJobId}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  checkAndUpdateRunpodStatus
}; 
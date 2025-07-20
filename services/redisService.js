const Redis = require('ioredis');
const logger = require('../utils/logger');

/**
 * Redis service for caching job statuses and queue management
 */
class RedisService {
  constructor() {
    // Initialize Redis client
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || '',
      db: process.env.REDIS_DB || 0,
      keyPrefix: 'audio-separator:',
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    // Log Redis connection status
    this.client.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    this.client.on('error', (error) => {
      logger.error(`Redis connection error: ${error.message}`);
    });

    // Set expiration time for job status (24 hours)
    this.JOB_STATUS_EXPIRY = 86400;
    
    // Queue settings
    this.QUEUE_KEY = 'processing:queue';
    this.QUEUE_PROCESSING_KEY = 'processing:active';
    this.QUEUE_MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENT_JOBS || 10);
    
    // Valid status states
    this.VALID_STATUSES = [
      'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'QUEUED', 
      'IN_QUEUE', 'IN_PROGRESS'
    ];
    
    logger.info(`Redis service initialized with max concurrency: ${this.QUEUE_MAX_CONCURRENCY}`);
  }

  /**
   * Get job status from cache
   * @param {string} jobId - Job ID
   * @returns {Promise<Object|null>} - Job status object or null if not found
   */
  async getJobStatus(jobId) {
    try {
      const key = `job:${jobId}`;
      const data = await this.client.get(key);
      
      if (!data) return null;
      
      return JSON.parse(data);
    } catch (error) {
      logger.error(`Error getting job status from Redis: ${error.message}`);
      return null;
    }
  }

  /**
   * Set job status in cache
   * @param {string} jobId - Job ID
   * @param {Object} status - Job status object
   * @returns {Promise<boolean>} - Success status
   */
  async setJobStatus(jobId, status) {
    try {
      const key = `job:${jobId}`;
      await this.client.set(key, JSON.stringify(status), 'EX', this.JOB_STATUS_EXPIRY);
      return true;
    } catch (error) {
      logger.error(`Error setting job status in Redis: ${error.message}`);
      return false;
    }
  }

  /**
   * Add job to processing queue
   * @param {Object} job - Job data
   * @returns {Promise<boolean>} - Success status
   */
  async addToQueue(job) {
    try {
      // First update the job status to QUEUED
      await this.setJobStatus(job.separationId, {
        ...job,
        status: 'QUEUED',
        queuedAt: new Date().toISOString()
      });
      
      await this.client.lpush(this.QUEUE_KEY, JSON.stringify(job));
      logger.info(`Added job to queue: ${job.separationId}`);
      
      // Trigger processing immediately - no need to wait for interval
      await this.processQueue();
      return true;
    } catch (error) {
      logger.error(`Error adding job to queue: ${error.message}`);
      return false;
    }
  }

  /**
   * Process jobs from queue (up to max concurrency)
   * @returns {Promise<number>} - Number of jobs started
   */
  async processQueue() {
    try {
      // Get current number of active jobs
      const activeCount = await this.client.llen(this.QUEUE_PROCESSING_KEY);
      
      // Calculate how many jobs we can start
      const availableSlots = Math.max(0, this.QUEUE_MAX_CONCURRENCY - activeCount);
      
      if (availableSlots <= 0) {
  
        return 0;
      }
      
      
      let startedCount = 0;
      
      // Get waiting jobs count to optimize processing
      const waitingCount = await this.client.llen(this.QUEUE_KEY);
      if (waitingCount === 0) {
        
        return 0;
      }
      
      // Start processing jobs up to available slots
      for (let i = 0; i < Math.min(availableSlots, waitingCount); i++) {
        // Move job from waiting queue to processing queue
        const jobData = await this.client.rpoplpush(this.QUEUE_KEY, this.QUEUE_PROCESSING_KEY);
        
        if (!jobData) {
          
          break;
        }
        
        const job = JSON.parse(jobData);
        
        // Trigger processing (executed outside Redis to avoid blocking)
        setImmediate(async () => {
          try {
            // Update job status to START_PROCESSING
            await this.setJobStatus(job.separationId, {
              ...job,
              status: 'IN_PROGRESS',
              startedAt: new Date().toISOString()
            });
            
            // Update the database record with the new status
            const Separation = require('../models/separation');
            const separation = await Separation.findById(job.separationId);
            if (separation) {
              separation.status = 'IN_PROGRESS';
              await separation.save();
              logger.info(`Updated job status in database: ${job.separationId} -> IN_PROGRESS`);
            }
            
            logger.info(`Started processing job: ${job.separationId}`);
          } catch (error) {
            logger.error(`Error processing job ${job.separationId}: ${error.message}`);
            // Move job back to queue on error
            await this.client.lrem(this.QUEUE_PROCESSING_KEY, 1, jobData);
            await this.client.lpush(this.QUEUE_KEY, jobData);
            
            // Update status to reflect the error
            await this.setJobStatus(job.separationId, {
              ...job,
              status: 'FAILED',
              error: error.message,
              failedAt: new Date().toISOString()
            });
            
            // Update database record
            try {
              const Separation = require('../models/separation');
              const separation = await Separation.findById(job.separationId);
              if (separation) {
                separation.status = 'FAILED';
                separation.errorMessage = error.message;
                await separation.save();
              }
            } catch (dbError) {
              logger.error(`Error updating database after processing failure: ${dbError.message}`);
            }
          }
        });
        
        startedCount++;
      }
      
      return startedCount;
    } catch (error) {
      logger.error(`Error processing queue: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get queue statistics
   * @returns {Promise<Object>} - Queue statistics
   */
  async getQueueStats() {
    try {
      const [queueLength, processingLength] = await Promise.all([
        this.client.llen(this.QUEUE_KEY),
        this.client.llen(this.QUEUE_PROCESSING_KEY)
      ]);
      
      return {
        waiting: queueLength,
        processing: processingLength,
        maxConcurrency: this.QUEUE_MAX_CONCURRENCY,
        availableSlots: Math.max(0, this.QUEUE_MAX_CONCURRENCY - processingLength)
      };
    } catch (error) {
      logger.error(`Error getting queue stats: ${error.message}`);
      return {
        waiting: 0,
        processing: 0,
        maxConcurrency: this.QUEUE_MAX_CONCURRENCY,
        availableSlots: this.QUEUE_MAX_CONCURRENCY,
        error: error.message
      };
    }
  }

  /**
   * Update job status with progress information
   * @param {string} jobId - Job ID 
   * @param {string} status - New status value
   * @param {Object} additionalData - Additional data to include in status
   * @returns {Promise<boolean>} - Success status
   */
  async updateJobStatus(jobId, status, additionalData = {}) {
    try {
      if (!this.VALID_STATUSES.includes(status)) {
        logger.warn(`Invalid status value: ${status}`);
        return false;
      }
      
      // Get current job status
      const currentStatus = await this.getJobStatus(jobId);
      if (!currentStatus) {
        logger.warn(`Cannot update non-existent job: ${jobId}`);
        return false;
      }
      
      // Update status in Redis
      const updatedStatus = {
        ...currentStatus,
        ...additionalData,
        status,
        updatedAt: new Date().toISOString()
      };
      
      await this.setJobStatus(jobId, updatedStatus);
      
      // Update status in database
      try {
        const Separation = require('../models/separation');
        const separation = await Separation.findById(jobId);
        if (separation) {
          separation.status = status;
          
          // Update additional fields if provided
          if (additionalData.error || additionalData.errorMessage) {
            separation.errorMessage = additionalData.error || additionalData.errorMessage;
          }
          
          if (additionalData.processingMessage) {
            separation.processingMessage = additionalData.processingMessage;
          }
          
          if (additionalData.vocalUrl) {
            separation.vocalUrl = additionalData.vocalUrl;
          }
          
          if (additionalData.instrumentalUrl) {
            separation.instrumentalUrl = additionalData.instrumentalUrl;
          }
          
          if (additionalData.executionTime) {
            separation.executionTime = additionalData.executionTime;
          }
          
          await separation.save();
          logger.info(`Updated job status in database: ${jobId} -> ${status}`);
        }
      } catch (dbError) {
        logger.error(`Error updating database after status change: ${dbError.message}`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error updating job status: ${error.message}`);
      return false;
    }
  }

  /**
   * Mark job as completed and remove from processing list
   * @param {string} jobId - Job ID
   * @param {string} finalStatus - Final status (COMPLETED or FAILED)
   * @param {Object} resultData - Result data for completed jobs
   * @returns {Promise<boolean>} - Success status
   */
  async completeJob(jobId, finalStatus = 'COMPLETED', resultData = {}) {
    try {
      // Find job in processing list
      const processingJobs = await this.client.lrange(this.QUEUE_PROCESSING_KEY, 0, -1);
      let jobRemoved = false;
      
      for (const jobData of processingJobs) {
        const job = JSON.parse(jobData);
        
        if (job.separationId === jobId) {
          // Remove job from processing list
          await this.client.lrem(this.QUEUE_PROCESSING_KEY, 1, jobData);
          jobRemoved = true;
          break;
        }
      }
      
      if (!jobRemoved) {
        logger.warn(`Job ${jobId} not found in processing list, may have been already removed`);
      }
      
      // Update job status with final state in MongoDB
      await this.updateJobStatus(jobId, finalStatus, {
        ...resultData,
        completedAt: new Date().toISOString()
      });
      
      // Delete the job from Redis
      const key = `job:${jobId}`;
      await this.client.del(key);
      logger.info(`Removed job ${jobId} from Redis database after status: ${finalStatus}`);
      
      logger.info(`Completed job: ${jobId} with status: ${finalStatus}`);
      
      // Trigger queue processing for next job immediately
      setImmediate(async () => {
        await this.processQueue();
      });
      
      return true;
    } catch (error) {
      logger.error(`Error completing job ${jobId}: ${error.message}`);
      return false;
    }
  }
}

module.exports = new RedisService(); 
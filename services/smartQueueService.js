const Redis = require('ioredis');
const queueConfig = require('../config/queueConfig');
const runpodService = require('./runpodService');
const Separation = require('../models/separation');
const logger = require('../utils/logger');

/**
 * Smart Queue Service for High Traffic Management
 * এই service টি high traffic handle করে RunPod API এর উপর load control করে
 */
class SmartQueueService {
  constructor() {
    // Redis client initialization
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || '',
      db: process.env.REDIS_DB || 0,
      keyPrefix: 'audio-separator:smart:',
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    // Configuration
    this.RUNPOD_RATE_LIMIT = parseInt(process.env.RUNPOD_RATE_LIMIT || '8'); // Max 8 requests per minute
    this.MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '5');
    this.PRIORITY_FILE_LIMIT = parseInt(process.env.PRIORITY_FILE_LIMIT || '3');
    this.MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '50');
    
    // Queue Keys
    this.QUEUE_HIGH_PRIORITY = 'queue:files';     // Uploaded files (highest priority)
    this.QUEUE_NORMAL_PRIORITY = 'queue:urls';    // URLs (normal priority)
    this.QUEUE_RETRY = 'queue:retry';            // Failed jobs for retry
    
    // State tracking
    this.processingJobs = new Map();
    this.runpodRequestTimes = [];
    this.circuitBreakerState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.userLimitCache = new Map();
    
    // Metrics
    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      avgProcessingTime: 120, // Default 2 minutes
      queueFullRejections: 0,
      runpodRateLimitHits: 0,
      circuitBreakerTrips: 0,
      peakConcurrency: 0
    };
    
    this.initializeProcessing();
    logger.info('Smart Queue Service initialized with intelligent load balancing');
  }

  /**
   * Initialize processing intervals
   */
  initializeProcessing() {
    // High priority processing (every 3 seconds)
    setInterval(() => this.processQueue('HIGH'), 3000);
    
    // Normal priority processing (every 8 seconds)
    setInterval(() => this.processQueue('NORMAL'), 8000);
    
    // Job status monitoring (every 15 seconds)
    setInterval(() => this.monitorRunningJobs(), 15000);
    
    // Retry failed jobs (every 2 minutes)
    setInterval(() => this.processRetryQueue(), 120000);
    
    // Cleanup and metrics (every 5 minutes)
    setInterval(() => this.performCleanup(), 300000);
    
    // Rate limit reset (every minute)
    setInterval(() => this.resetRateLimits(), 60000);
  }

  /**
   * Main entry point: Add job to queue with intelligent routing
   */
  async addJob(jobData) {
    try {
      if (!jobData || !jobData.separationId) {
        throw new Error('Invalid job data: separationId is required');
      }

      const userId = jobData.userId || 'unknown';
      
      // Check user rate limits (max 2 concurrent, 5 per hour)
      if (!await this.checkUserLimits(userId)) {
        logger.warn(`User ${userId} exceeded rate limits`);
        await this.updateJobStatus(jobData.separationId, 'RATE_LIMITED', {
          message: 'Rate limit exceeded. Max 2 concurrent jobs, 5 per hour.',
          userId: userId
        });
        return false;
      }

      // Check circuit breaker
      if (this.circuitBreakerState === 'OPEN') {
        logger.warn(`Circuit breaker is OPEN, rejecting job ${jobData.separationId}`);
        await this.updateJobStatus(jobData.separationId, 'SERVICE_UNAVAILABLE', {
          message: 'Service temporarily unavailable due to high load. Please try again in a few minutes.'
        });
        return false;
      }

      // Check total queue capacity
      const currentQueueSize = await this.getTotalQueueSize();
      if (currentQueueSize >= this.MAX_QUEUE_SIZE) {
        this.metrics.queueFullRejections++;
        
        logger.warn(`Queue at capacity (${currentQueueSize}/${this.MAX_QUEUE_SIZE}), rejecting job ${jobData.separationId}`);
        
        await this.updateJobStatus(jobData.separationId, 'QUEUE_FULL', {
          message: 'Server is at capacity. Please try again in a few minutes.',
          currentQueueSize: currentQueueSize,
          maxQueueSize: this.MAX_QUEUE_SIZE
        });
        return false;
      }

      // Determine priority and queue
      const isFileUpload = jobData.storageType === 'file' || jobData.storageType === 'local';
      const priority = isFileUpload ? 'HIGH' : 'NORMAL';
      const queueKey = isFileUpload ? this.QUEUE_HIGH_PRIORITY : this.QUEUE_NORMAL_PRIORITY;

      // Enhanced job data
      const enhancedJobData = {
        ...jobData,
        priority: priority,
        addedAt: new Date().toISOString(),
        retryCount: 0,
        userId: userId,
        estimatedTime: this.estimateProcessingTime(jobData)
      };

      // Add to appropriate queue
      await this.redis.lpush(queueKey, JSON.stringify(enhancedJobData));
      
      // Update user tracking
      await this.updateUserLimits(userId);

      // Calculate queue position and estimated wait
      const queuePosition = await this.redis.llen(queueKey);
      const estimatedWait = await this.calculateEstimatedWait(queuePosition, priority);
      
      await this.updateJobStatus(jobData.separationId, 'QUEUED', {
        priority: priority,
        queuePosition: queuePosition,
        estimatedWaitMinutes: Math.ceil(estimatedWait / 60),
        userId: userId
      });

      logger.info(`Job ${jobData.separationId} queued with ${priority} priority (position: ${queuePosition}, wait: ~${Math.ceil(estimatedWait / 60)} min)`);

      // Trigger immediate processing if capacity available
      if (this.processingJobs.size < this.MAX_CONCURRENT_JOBS) {
        setImmediate(() => this.processQueue(priority));
      }

      return true;

    } catch (error) {
      logger.error(`Error adding job to smart queue: ${error.message}`);
      await this.updateJobStatus(jobData.separationId, 'QUEUE_ERROR', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Process specific priority queue
   */
  async processQueue(priority) {
    try {
      // Check if we can process more jobs
      if (!this.canProcessMoreJobs(priority)) {
        return;
      }

      // Check RunPod rate limiting
      if (!this.canMakeRunpodRequest()) {
        this.metrics.runpodRateLimitHits++;
        return;
      }

      const queueKey = priority === 'HIGH' ? this.QUEUE_HIGH_PRIORITY : this.QUEUE_NORMAL_PRIORITY;
      const jobData = await this.redis.rpop(queueKey);
      
      if (!jobData) {
        return; // No jobs in queue
      }

      const job = JSON.parse(jobData);
      await this.startJobProcessing(job);

    } catch (error) {
      logger.error(`Error processing ${priority} priority queue: ${error.message}`);
    }
  }

  /**
   * Start processing a specific job
   */
  async startJobProcessing(jobData) {
    try {
      const { separationId } = jobData;

      // Add to processing tracker
      this.processingJobs.set(separationId, {
        ...jobData,
        startedAt: new Date(),
        status: 'PROCESSING',
        runpodJobId: null
      });

      // Update metrics
      const currentConcurrency = this.processingJobs.size;
      this.metrics.peakConcurrency = Math.max(this.metrics.peakConcurrency, currentConcurrency);

      // Update job status
      await this.updateJobStatus(separationId, 'PROCESSING', {
        message: 'Submitting to audio separation service...',
        startedAt: new Date().toISOString(),
        progress: 10
      });

      // Record RunPod request for rate limiting
      this.recordRunpodRequest();

      // Submit to RunPod
      const timeout = this.getTimeoutForJob(jobData);
      const result = await runpodService.processAsynchronously(
        jobData.filePath || jobData.publicUrl, 
        timeout
      );

      if (result && result.id) {
        // Update processing job with RunPod ID
        const processingJob = this.processingJobs.get(separationId);
        if (processingJob) {
          processingJob.runpodJobId = result.id;
          processingJob.runpodSubmittedAt = new Date();
        }

        // Update database
        await Separation.findByIdAndUpdate(separationId, {
          runpodJobId: result.id,
          status: 'PROCESSING'
        });

        // Update job status
        await this.updateJobStatus(separationId, 'PROCESSING', {
          message: 'Audio separation in progress...',
          runpodJobId: result.id,
          progress: 25
        });

        // Reset circuit breaker on success
        if (this.circuitBreakerState === 'HALF_OPEN') {
          this.circuitBreakerState = 'CLOSED';
          logger.info('Circuit breaker reset to CLOSED');
        }

        logger.info(`Job ${separationId} submitted to RunPod: ${result.id}`);

      } else {
        throw new Error('Failed to get valid response from RunPod');
      }

    } catch (error) {
      logger.error(`Error starting job processing ${jobData.separationId}: ${error.message}`);
      
      // Handle circuit breaker
      await this.handleRunpodError(error);
      
      // Remove from processing
      this.processingJobs.delete(jobData.separationId);
      
      // Determine if this should be retried
      if (this.shouldRetryJob(jobData, error)) {
        await this.addJobToRetryQueue(jobData, error.message);
      } else {
        await this.updateJobStatus(jobData.separationId, 'FAILED', {
          error: error.message,
          stage: 'runpod_submission'
        });
      }
    }
  }

  /**
   * Monitor running jobs
   */
  async monitorRunningJobs() {
    try {
      const processingJobs = Array.from(this.processingJobs.values());
      
      for (const job of processingJobs) {
        if (!job.runpodJobId) continue;

        try {
          const status = await runpodService.checkStatus(job.runpodJobId);
          
          if (status.status === 'COMPLETED') {
            await this.handleJobCompletion(job.separationId, status);
          } else if (status.status === 'FAILED') {
            await this.handleJobFailure(job.separationId, status);
          } else {
            await this.updateJobProgress(job.separationId, status);
          }

        } catch (statusError) {
          // Handle timeout for long-running jobs
          const jobAge = Date.now() - job.startedAt.getTime();
          if (jobAge > 45 * 60 * 1000) { // 45 minutes timeout
            await this.handleJobTimeout(job.separationId);
          }
        }
      }

    } catch (error) {
      logger.error(`Error monitoring running jobs: ${error.message}`);
    }
  }

  /**
   * Handle job completion
   */
  async handleJobCompletion(separationId, runpodResult) {
    try {
      const processingJob = this.processingJobs.get(separationId);
      if (!processingJob) return;

      const processingTime = Date.now() - processingJob.startedAt.getTime();
      
      // Update metrics
      this.metrics.totalProcessed++;
      this.metrics.avgProcessingTime = (this.metrics.avgProcessingTime + processingTime/1000) / 2;

      // Update database
      await Separation.findByIdAndUpdate(separationId, {
        status: 'COMPLETE',
        vocalUrl: runpodResult.output?.vocal_audio,
        instrumentalUrl: runpodResult.output?.instrument_audio,
        executionTime: runpodResult.executionTime || processingTime,
        completedAt: new Date()
      });

      // Update job status
      await this.updateJobStatus(separationId, 'COMPLETE', {
        vocalUrl: runpodResult.output?.vocal_audio,
        instrumentalUrl: runpodResult.output?.instrument_audio,
        processingTimeSeconds: Math.round(processingTime / 1000),
        progress: 100
      });

      // Remove from processing and update user limits
      this.processingJobs.delete(separationId);
      await this.decrementUserConcurrent(processingJob.userId);

      logger.info(`Job ${separationId} completed in ${Math.round(processingTime/1000)}s`);

    } catch (error) {
      logger.error(`Error handling job completion: ${error.message}`);
    }
  }

  /**
   * Handle job failure
   */
  async handleJobFailure(separationId, runpodResult) {
    try {
      const processingJob = this.processingJobs.get(separationId);
      
      this.metrics.totalFailed++;

      await Separation.findByIdAndUpdate(separationId, {
        status: 'FAILED',
        errorMessage: runpodResult.error || 'Processing failed'
      });

      await this.updateJobStatus(separationId, 'FAILED', {
        error: runpodResult.error || 'Processing failed',
        stage: 'runpod_processing'
      });

      this.processingJobs.delete(separationId);
      
      if (processingJob) {
        await this.decrementUserConcurrent(processingJob.userId);
      }
      
      logger.error(`Job ${separationId} failed: ${runpodResult.error}`);

    } catch (error) {
      logger.error(`Error handling job failure: ${error.message}`);
    }
  }

  /**
   * Rate limiting and capacity checks
   */
  canProcessMoreJobs(priority) {
    const totalProcessing = this.processingJobs.size;
    
    if (totalProcessing >= this.MAX_CONCURRENT_JOBS) {
      return false;
    }

    if (priority === 'HIGH') {
      const highPriorityJobs = Array.from(this.processingJobs.values())
        .filter(job => job.priority === 'HIGH').length;
      return highPriorityJobs < this.PRIORITY_FILE_LIMIT;
    }

    return true;
  }

  canMakeRunpodRequest() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Clean old requests
    this.runpodRequestTimes = this.runpodRequestTimes.filter(time => time > oneMinuteAgo);
    
    return this.runpodRequestTimes.length < this.RUNPOD_RATE_LIMIT;
  }

  recordRunpodRequest() {
    this.runpodRequestTimes.push(Date.now());
  }

  /**
   * User rate limiting
   */
  async checkUserLimits(userId) {
    const userKey = `user:${userId}`;
    const userData = await this.redis.hgetall(userKey);
    
    const now = Date.now();
    
    // Check concurrent limit (max 2)
    const concurrent = parseInt(userData.concurrent || '0');
    if (concurrent >= 2) {
      return false;
    }
    
    // Check hourly limit (max 5)
    const hourlyCount = parseInt(userData.hourly || '0');
    const lastHourReset = parseInt(userData.lastHourReset || '0');
    const oneHourAgo = now - 3600000;
    
    if (lastHourReset < oneHourAgo) {
      // Reset hourly counter
      await this.redis.hset(userKey, 'hourly', '0', 'lastHourReset', now.toString());
    } else if (hourlyCount >= 5) {
      return false;
    }
    
    return true;
  }

  async updateUserLimits(userId) {
    const userKey = `user:${userId}`;
    await this.redis.hincrby(userKey, 'concurrent', 1);
    await this.redis.hincrby(userKey, 'hourly', 1);
    await this.redis.expire(userKey, 7200); // 2 hours expiry
  }

  async decrementUserConcurrent(userId) {
    if (userId) {
      const userKey = `user:${userId}`;
      await this.redis.hincrby(userKey, 'concurrent', -1);
    }
  }

  /**
   * Utility functions
   */
  async getTotalQueueSize() {
    const [high, normal, retry] = await Promise.all([
      this.redis.llen(this.QUEUE_HIGH_PRIORITY),
      this.redis.llen(this.QUEUE_NORMAL_PRIORITY),
      this.redis.llen(this.QUEUE_RETRY)
    ]);
    
    return high + normal + retry;
  }

  estimateProcessingTime(jobData) {
    const fileSize = jobData.fileSize || 0;
    
    if (fileSize < 10 * 1024 * 1024) return 120; // Small: 2 min
    if (fileSize < 50 * 1024 * 1024) return 240; // Medium: 4 min
    if (fileSize < 200 * 1024 * 1024) return 480; // Large: 8 min
    return 720; // XLarge: 12 min
  }

  async calculateEstimatedWait(queuePosition, priority) {
    const avgTime = this.metrics.avgProcessingTime;
    const concurrentSlots = priority === 'HIGH' ? this.PRIORITY_FILE_LIMIT : 
                           (this.MAX_CONCURRENT_JOBS - this.PRIORITY_FILE_LIMIT);
    
    const currentProcessing = Array.from(this.processingJobs.values())
      .filter(job => job.priority === priority).length;
    
    const availableSlots = Math.max(1, concurrentSlots - currentProcessing);
    
    return Math.ceil(queuePosition / availableSlots) * avgTime;
  }

  getTimeoutForJob(jobData) {
    const fileSize = jobData.fileSize || 0;
    
    if (fileSize < 10 * 1024 * 1024) return 300000;   // 5 min
    if (fileSize < 50 * 1024 * 1024) return 600000;   // 10 min
    if (fileSize < 200 * 1024 * 1024) return 1200000; // 20 min
    return 1800000; // 30 min
  }

  /**
   * Circuit breaker logic
   */
  async handleRunpodError(error) {
    const isServiceError = error.response?.status >= 500 || 
                          error.code === 'ECONNRESET' || 
                          error.code === 'ETIMEDOUT';
    
    if (isServiceError) {
      const failures = await this.redis.incr('runpod_failures');
      await this.redis.expire('runpod_failures', 60); // 1 minute window
      
      if (failures >= 5) { // Trip after 5 failures
        this.circuitBreakerState = 'OPEN';
        this.metrics.circuitBreakerTrips++;
        logger.warn(`Circuit breaker OPEN due to ${failures} failures`);
        
        // Reset after 5 minutes
        setTimeout(() => {
          this.circuitBreakerState = 'HALF_OPEN';
          logger.info('Circuit breaker set to HALF_OPEN');
        }, 300000);
      }
    }
  }

  /**
   * Retry logic
   */
  shouldRetryJob(jobData, error) {
    const retryCount = jobData.retryCount || 0;
    if (retryCount >= 3) return false;
    
    // Retry for temporary errors
    const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];
    return retryableErrors.some(err => error.message.includes(err)) ||
           (error.response?.status >= 500);
  }

  async addJobToRetryQueue(jobData, errorMessage) {
    const retryCount = (jobData.retryCount || 0) + 1;
    const retryDelay = 60000 * Math.pow(2, retryCount - 1); // Exponential backoff
    
    const retryJobData = {
      ...jobData,
      retryCount,
      lastError: errorMessage,
      retryAt: new Date(Date.now() + retryDelay).toISOString()
    };
    
    await this.redis.lpush(this.QUEUE_RETRY, JSON.stringify(retryJobData));
    
    await this.updateJobStatus(jobData.separationId, 'RETRY_SCHEDULED', {
      retryCount,
      retryInMinutes: Math.ceil(retryDelay / 60000),
      lastError: errorMessage
    });
    
    logger.info(`Job ${jobData.separationId} scheduled for retry ${retryCount}`);
  }

  async processRetryQueue() {
    try {
      const jobData = await this.redis.rpop(this.QUEUE_RETRY);
      if (!jobData) return;
      
      const job = JSON.parse(jobData);
      const retryTime = new Date(job.retryAt);
      
      if (Date.now() >= retryTime.getTime()) {
        delete job.retryAt;
        delete job.lastError;
        
        logger.info(`Retrying job ${job.separationId} (attempt ${job.retryCount})`);
        await this.addJob(job);
      } else {
        // Put back in retry queue
        await this.redis.lpush(this.QUEUE_RETRY, JSON.stringify(job));
      }
      
    } catch (error) {
      logger.error(`Error processing retry queue: ${error.message}`);
    }
  }

  /**
   * Status management
   */
  async updateJobStatus(separationId, status, additionalData = {}) {
    try {
      const statusData = {
        separationId,
        status,
        updatedAt: new Date().toISOString(),
        ...additionalData
      };
      
      await this.redis.set(`status:${separationId}`, JSON.stringify(statusData), 'EX', 86400);
      
    } catch (error) {
      logger.error(`Error updating job status: ${error.message}`);
    }
  }

  async updateJobProgress(separationId, runpodStatus) {
    let progress = 50;
    
    if (runpodStatus.status === 'IN_QUEUE') progress = 30;
    else if (runpodStatus.status === 'IN_PROGRESS') progress = 70;
    
    await this.updateJobStatus(separationId, 'PROCESSING', {
      progress,
      runpodStatus: runpodStatus.status,
      message: `Processing: ${runpodStatus.status}`
    });
  }

  async handleJobTimeout(separationId) {
    const processingJob = this.processingJobs.get(separationId);
    
    await this.updateJobStatus(separationId, 'TIMEOUT', {
      error: 'Job timed out after 45 minutes'
    });
    
    this.processingJobs.delete(separationId);
    
    if (processingJob) {
      await this.decrementUserConcurrent(processingJob.userId);
    }
    
    logger.warn(`Job ${separationId} timed out`);
  }

  /**
   * Cleanup and maintenance
   */
  async performCleanup() {
    try {
      // Remove stale jobs
      const staleJobs = [];
      for (const [separationId, job] of this.processingJobs.entries()) {
        const jobAge = Date.now() - job.startedAt.getTime();
        if (jobAge > 60 * 60 * 1000) { // 1 hour
          staleJobs.push(separationId);
        }
      }
      
      for (const jobId of staleJobs) {
        await this.handleJobTimeout(jobId);
      }
      
      // Log statistics
      const stats = await this.getQueueStatistics();
      logger.info(`Smart Queue Stats: ${JSON.stringify(stats)}`);
      
    } catch (error) {
      logger.error(`Error in cleanup: ${error.message}`);
    }
  }

  resetRateLimits() {
    const oneMinuteAgo = Date.now() - 60000;
    this.runpodRequestTimes = this.runpodRequestTimes.filter(time => time > oneMinuteAgo);
  }

  /**
   * Public API methods
   */
  async getJobStatus(separationId) {
    try {
      const statusData = await this.redis.get(`status:${separationId}`);
      return statusData ? JSON.parse(statusData) : null;
    } catch (error) {
      logger.error(`Error getting job status: ${error.message}`);
      return null;
    }
  }

  async getQueueStatistics() {
    try {
      const [highPriority, normalPriority, retryQueue] = await Promise.all([
        this.redis.llen(this.QUEUE_HIGH_PRIORITY),
        this.redis.llen(this.QUEUE_NORMAL_PRIORITY),
        this.redis.llen(this.QUEUE_RETRY)
      ]);

      return {
        highPriorityWaiting: highPriority,
        normalPriorityWaiting: normalPriority,
        retryWaiting: retryQueue,
        totalWaiting: highPriority + normalPriority + retryQueue,
        currentlyProcessing: this.processingJobs.size,
        maxConcurrent: this.MAX_CONCURRENT_JOBS,
        runpodRateLimit: this.RUNPOD_RATE_LIMIT,
        runpodRequestsLastMinute: this.runpodRequestTimes.length,
        circuitBreakerState: this.circuitBreakerState,
        metrics: this.metrics
      };
      
    } catch (error) {
      logger.error(`Error getting queue statistics: ${error.message}`);
      return {};
    }
  }

  async healthCheck() {
    try {
      const checks = {
        redis: false,
        runpod: this.circuitBreakerState === 'CLOSED',
        queueSize: await this.getTotalQueueSize(),
        processing: this.processingJobs.size
      };
      
      try {
        await this.redis.ping();
        checks.redis = true;
      } catch (redisError) {
        logger.error(`Redis health check failed: ${redisError.message}`);
      }
      
      const healthy = checks.redis && checks.runpod && checks.queueSize < this.MAX_QUEUE_SIZE;
      
      return {
        healthy,
        checks,
        metrics: this.metrics,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      logger.error(`Health check error: ${error.message}`);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = new SmartQueueService();
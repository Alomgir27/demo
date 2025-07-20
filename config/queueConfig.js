/**
 * Advanced Queue Configuration for High Traffic Management
 * This file contains all queue-related configurations for handling high user load
 */

const queueConfig = {
  // RunPod API Rate Limiting
  runpod: {
    rateLimit: parseInt(process.env.RUNPOD_RATE_LIMIT || '8'), // Max 8 requests per minute
    maxRetries: parseInt(process.env.RUNPOD_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.RUNPOD_RETRY_DELAY || '60000'), // 1 minute
    timeoutMs: parseInt(process.env.RUNPOD_TIMEOUT || '900000'), // 15 minutes
  },

  // Queue Management
  queue: {
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '5'),
    priorityFileLimit: parseInt(process.env.PRIORITY_FILE_LIMIT || '3'), // Files get priority
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '50'), // Total queue limit
    
    // Queue Types
    priorities: {
      HIGH: 'high_priority', // Uploaded files
      NORMAL: 'normal_priority', // URLs
      RETRY: 'retry_queue',
      FAILED: 'failed_queue'
    },
    
    // Processing Intervals (in ms)
    intervals: {
      highPriority: 3000,  // Check every 3 seconds
      normalPriority: 8000, // Check every 8 seconds
      statusMonitoring: 15000, // Check status every 15 seconds
      retryProcessing: 120000, // Retry failed jobs every 2 minutes
      cleanup: 300000, // Cleanup every 5 minutes
      loadBalancing: 30000 // Adjust load every 30 seconds
    }
  },

  // Load Balancing & Auto-scaling
  loadBalancing: {
    peakHours: {
      start: 9, // 9 AM
      end: 22,  // 10 PM
      multiplier: 1.5 // Increase capacity by 50% during peak hours
    },
    
    // Traffic thresholds
    thresholds: {
      high: 0.8,     // 80% capacity triggers scaling
      critical: 0.95, // 95% capacity triggers emergency measures
      lowLoad: 0.3   // 30% capacity allows scaling down
    },
    
    // Auto-scaling parameters
    scaling: {
      scaleUpThreshold: 10,   // Queue length threshold to scale up
      scaleDownThreshold: 2,  // Queue length threshold to scale down
      cooldownPeriod: 300000, // 5 minutes between scaling events
    }
  },

  // Job Management
  jobs: {
    // Timeout settings
    timeouts: {
      queueWait: 1800000,    // 30 minutes max wait in queue
      processing: 2700000,   // 45 minutes max processing time
      monitoring: 180000,    // 3 minutes between status checks
      stale: 3600000        // 1 hour to mark job as stale
    },
    
    // Retry logic
    retry: {
      maxAttempts: 3,
      baseDelay: 60000,      // 1 minute
      exponentialFactor: 2,  // Double delay each retry
      jitterMs: 30000       // ±30 seconds random jitter
    },
    
    // Priority scoring
    priorityScoring: {
      fileUpload: 100,       // Highest priority
      urlSmallFile: 50,      // Medium priority
      urlLargeFile: 25,      // Lower priority
      retryJob: 75          // High priority for retries
    }
  },

  // Traffic Management
  traffic: {
    // Rate limiting per user/IP
    userLimits: {
      concurrent: 2,         // Max 2 concurrent jobs per user
      daily: 20,            // Max 20 jobs per day per user
      hourly: 5             // Max 5 jobs per hour per user
    },
    
    // Queue admission control
    admissionControl: {
      enabled: true,
      maxWaitTime: 1800,    // 30 minutes max estimated wait
      queueFullMessage: 'Server is at capacity. Please try again in a few minutes.',
      estimatedWaitAccuracy: 0.8 // 80% accuracy in wait time estimation
    },
    
    // Circuit breaker for RunPod
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,   // Trip after 5 failures
      resetTimeout: 300000,  // 5 minutes before retry
      monitoringPeriod: 60000 // 1 minute monitoring window
    }
  },

  // Monitoring & Analytics
  monitoring: {
    // Metrics collection
    metrics: {
      enabled: true,
      interval: 60000,       // Collect metrics every minute
      retention: 86400000,   // Keep metrics for 24 hours
      
      // Key metrics to track
      track: [
        'queue_length',
        'processing_time',
        'success_rate',
        'error_rate',
        'runpod_response_time',
        'user_concurrency'
      ]
    },
    
    // Alerting thresholds
    alerts: {
      queueLength: 30,       // Alert if queue > 30 jobs
      errorRate: 0.1,        // Alert if error rate > 10%
      avgProcessingTime: 600, // Alert if avg time > 10 minutes
      runpodFailures: 3      // Alert after 3 consecutive RunPod failures
    },
    
    // Health checks
    healthCheck: {
      interval: 30000,       // Every 30 seconds
      endpoints: [
        'redis_connection',
        'runpod_api',
        'database_connection',
        'queue_processing'
      ]
    }
  },

  // Redis Configuration
  redis: {
    keyPrefix: 'audio-separator:v2:',
    ttl: {
      jobStatus: 86400,      // 24 hours
      queueData: 7200,       // 2 hours
      metrics: 86400,        // 24 hours
      userLimits: 3600      // 1 hour
    },
    
    // Connection settings
    connection: {
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000
    }
  },

  // Storage Configuration
  storage: {
    // File size thresholds for different processing strategies
    sizeThresholds: {
      small: 10 * 1024 * 1024,    // 10 MB
      medium: 50 * 1024 * 1024,   // 50 MB  
      large: 200 * 1024 * 1024,   // 200 MB
      xlarge: 500 * 1024 * 1024   // 500 MB
    },
    
    // Processing strategies by file size
    strategies: {
      small: { priority: 'high', timeout: 300000 },     // 5 minutes
      medium: { priority: 'normal', timeout: 600000 },  // 10 minutes
      large: { priority: 'normal', timeout: 1200000 },  // 20 minutes
      xlarge: { priority: 'low', timeout: 1800000 }     // 30 minutes
    }
  }
};

module.exports = queueConfig; 
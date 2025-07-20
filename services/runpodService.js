const axios = require('axios');
const config = require('../config/api');
const logger = require('../utils/logger');

/**
 * RunPod service for interacting with the ClearVocals API
 * Enhanced for high reliability and load balancing
 */
class RunpodService {
  constructor() {
    this.baseUrl = `https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID || config.runpod.endpoint_id}`;
    this.apiKey = process.env.API_ACCESS_TOKEN || config.runpod.api_key;
    
    // Validate API key exists
    if (!this.apiKey) {
      logger.error('RunPod API key not configured! Please set API_ACCESS_TOKEN environment variable.');
      throw new Error('RunPod API key not configured');
    }
    

    const apiKeyMasked = this.apiKey ? `${this.apiKey.substr(0, 4)}...${this.apiKey.substr(-4)}` : 'Not configured';
    logger.info(`RunPod service initialized with endpoint: ${this.baseUrl}`);
    logger.info(`RunPod API key configured: ${apiKeyMasked}`);
    
    // Create axios instance with defaults for all requests
    this.client = axios.create({
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 second timeout for API requests (increased from 30sec)
    });
    
    // Add response interceptor for logging
    this.client.interceptors.response.use(
      response => response,
      error => {
        this.logRequestError(error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Log API request errors with detailed information
   */
  logRequestError(error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      logger.error(`RunPod API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      logger.error(`Request URL: ${error.config.url}`);
      logger.error(`Request method: ${error.config.method}`);
    } else if (error.request) {
      // The request was made but no response was received
      logger.error(`RunPod API no response: ${error.message}`);
      logger.error(`Request URL: ${error.config.url}`);
    } else {
      // Something happened in setting up the request that triggered an Error
      logger.error(`RunPod API setup error: ${error.message}`);
    }
  }

  /**
   * Process audio asynchronously - RECOMMENDED METHOD for production use
   * Handles large files better and works with the queue system
   * @param {string} audioUrl - URL of the audio file
   * @param {number} timeout - Execution timeout in milliseconds
   * @returns {Promise} - API response with job ID
   */
  async processAsynchronously(audioUrl, timeout = 900000) {
    try {
      if (!audioUrl) {
        throw new Error('Audio URL is required');
      }

      // Skip URL validation and directly use the provided URL
      // This significantly improves performance as we no longer parse and reconstruct the URL
      logger.info(`RunPod Service - Processing URL asynchronously: ${audioUrl}`);
      
      // Format payload exactly as specified in the RunPod API documentation
      const payload = {
        input: {
          input_audio: audioUrl
        },
        policy: {
          executionTimeout: timeout
        }
      };
      

      
      // Make the API request with proper headers
      const response = await this.client.post(
        `${this.baseUrl}/run`,
        payload
      );
      
      // Validate the response has expected structure
      if (!response.data || !response.data.id) {
        throw new Error('Invalid response from RunPod API: Missing job ID');
      }
      
      logger.info(`RunPod async job submitted successfully: ${response.data.id}`);
      return response.data;
    } catch (error) {
      logger.error(`Error processing audio asynchronously: ${error.message}`);
      
      // Include more detailed error information
      if (error.response) {
        logger.error(`RunPod API response error: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data || {})}`);
        
        // Handle 401 specifically
        if (error.response.status === 401) {
          logger.error('RunPod API authentication failed. Check your API key.');
          throw new Error('RunPod API authentication failed. Please check your API key configuration.');
        }
      }
      
      // Attempt retry for server errors (but not for auth errors)
      if (error.response && error.response.status >= 500) {
        logger.info('Retrying async processing due to server error');
        // Short delay before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.processAsynchronously(audioUrl, timeout);
      }
      
      throw error;
    }
  }

  /**
   * Check the status of an asynchronous job
   * @param {string} jobId - ID of the job
   * @returns {Promise} - API response with job status
   */
  async checkStatus(jobId) {
    try {
      if (!jobId) {
        throw new Error('Job ID is required');
      }
      

      
      // Make the GET request to the status endpoint
      const response = await this.client.get(`${this.baseUrl}/status/${jobId}`);
      

      
      // Standardize the output for checkStatus to match the synchronous processing response
      const data = response.data;

      // Basic validation of response structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from RunPod API');
      }
      
      // Return the standardized response based on status
      if (data.status === 'COMPLETED' && data.output) {
        // For completed jobs, check the processing_status in the output
        if (data.output.processing_status === 'COMPLETED') {
          logger.info(`RunPod job ${jobId} completed successfully with status: COMPLETED`);

          return {
            id: data.id,
            status: data.status,
            output: {
              processing_status: 'COMPLETED',
              vocal_audio: data.output.vocal_audio,
              instrument_audio: data.output.instrument_audio
            },
            executionTime: data.executionTime,
            delayTime: data.delayTime
          };
        } else if (data.output.processing_status === 'FAILED') {
          logger.error(`RunPod job ${jobId} processing failed: ${data.output.failed_reason || 'Unknown reason'}`);
          return {
            id: data.id,
            status: 'FAILED',
            error: data.output.failed_reason || 'Processing failed',
            executionTime: data.executionTime,
            delayTime: data.delayTime
          };
        }
      } else if (data.status === 'FAILED') {
        logger.error(`RunPod job ${jobId} failed: ${data.error || 'Unknown error'}`);
        return {
          id: data.id,
          status: 'FAILED',
          error: data.error || 'Job failed',
          executionTime: data.executionTime,
          delayTime: data.delayTime
        };
      } else if (data.status === 'IN_QUEUE' || data.status === 'IN_PROGRESS') {

        return {
          id: data.id,
          status: data.status,
          executionTime: data.executionTime || 0,
          delayTime: data.delayTime || 0
        };
      }
      
      // Return the original response for any other status
      return {
        ...data,
        delayTime: data.delayTime
      };
    } catch (error) {
      logger.error(`Error checking job status for ${jobId}: ${error.message}`);
      
      // Log more detailed error information
      if (error.response) {
        logger.error(`Status check response error: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data || {})}`);
      }
      
      // Retry for server errors
      if (error.response && error.response.status >= 500) {
        logger.info('Retrying status check due to server error');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.checkStatus(jobId);
      }
      
      throw error;
    }
  }
  
  /**
   * Cancel an asynchronous job
   * @param {string} jobId - ID of the job to cancel
   * @returns {Promise} - API response
   */
  async cancelJob(jobId) {
    try {
      if (!jobId) {
        throw new Error('Job ID is required');
      }
      
      const response = await this.client.post(`${this.baseUrl}/cancel/${jobId}`);
      
      logger.info(`Job ${jobId} cancelled`);
      return response.data;
    } catch (error) {
      logger.error(`Error cancelling job ${jobId}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new RunpodService(); 
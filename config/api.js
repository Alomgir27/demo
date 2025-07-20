/**
 * API Configuration
 * Contains settings for external API services
 */

const logger = require('../utils/logger');

// Check for required environment variables
const runpodEndpointId = process.env.RUNPOD_ENDPOINT_ID || '2nxbtdiopx35e4';
const apiAccessToken = process.env.API_ACCESS_TOKEN;

// Log warnings if important configs are missing
if (!apiAccessToken) {
  logger.warn('WARNING: API_ACCESS_TOKEN is not defined in environment variables. RunPod API calls will fail.');
}

if (!process.env.RUNPOD_ENDPOINT_ID) {
  logger.warn('WARNING: RUNPOD_ENDPOINT_ID is not defined in environment variables. Using default endpoint ID.');
}

const config = {
  // RunPod configuration
  runpod: {
    endpoint_id: runpodEndpointId,
    api_key: apiAccessToken,
    base_url: `https://api.runpod.ai/v2/${runpodEndpointId}`,
    timeout: parseInt(process.env.RUNPOD_TIMEOUT || '360000'), // Default 6 minutes
  },
};

module.exports = config; 
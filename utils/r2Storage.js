const { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);

// Implement connection pooling for AWS S3 client
const connectionPool = {
  clients: [],
  maxSize: process.env.R2_CONNECTION_POOL_SIZE || 5,
  index: 0,
  
  // Initialize client pool
  init() {
    for (let i = 0; i < this.maxSize; i++) {
      this.clients.push(new S3Client({
        endpoint: process.env.R2_ENDPOINT,
        region: process.env.R2_REGION || 'auto',
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true
      }));
    }
    logger.info(`R2 connection pool initialized with ${this.maxSize} clients`);
  },
  
  // Get next client in round-robin fashion
  getClient() {
    if (this.clients.length === 0) {
      this.init();
    }
    const client = this.clients[this.index];
    this.index = (this.index + 1) % this.maxSize;
    return client;
  }
};

// Initialize the connection pool
connectionPool.init();

/**
 * Retry mechanism with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelay - Initial delay in ms
 * @returns {Promise} - Result of the function
 */
const withRetry = async (fn, maxRetries = 3, initialDelay = 500) => {
  let retries = 0;
  let lastError;
  
  while (retries <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Only retry on these specific errors
      const shouldRetry = error.name === 'SlowDown' ||
                         error.name === 'RequestTimeout' ||
                         error.name === 'NetworkingError' ||
                         (error.$metadata && error.$metadata.httpStatusCode >= 500);
      
      if (!shouldRetry || retries >= maxRetries) {
        throw error;
      }
      
      const delay = initialDelay * Math.pow(2, retries);
      logger.warn(`R2 operation failed with ${error.name}, retrying in ${delay}ms (${retries + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      retries++;
    }
  }
  
  throw lastError;
};

/**
 * Upload a file to Cloudflare R2
 * @param {Object} file - File object (can be buffer or path)
 * @param {string} customKey - Optional custom key (filename in bucket)
 * @returns {Promise<Object>} - Upload result with file URL
 */
const uploadFile = async (file, customKey = null) => {
  try {
    // Generate a unique filename if not provided
    const key = customKey || `uploads/${Date.now()}-${path.basename(file.originalname || file.path || 'file')}`;
    
    // Prepare file data
    let fileData;
    let fileSize = 0;
    
    if (file.buffer) {
      // If file is already in memory (from multer)
      fileData = file.buffer;
      fileSize = file.buffer.length;
    } else if (file.path) {
      // If file is on disk
      fileData = fs.createReadStream(file.path);
      const stats = await fs.promises.stat(file.path);
      fileSize = stats.size;
    } else {
      throw new Error('Invalid file object');
    }
    
    // Use multipart upload for large files
    if (fileSize > 5 * 1024 * 1024) { // 5MB threshold
      return await uploadLargeFile(file, key, fileSize);
    }

    // Upload parameters for smaller files
    const params = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: fileData,
      ContentType: file.mimetype || 'application/octet-stream',
    };

    // Perform upload with retry
    const r2Client = connectionPool.getClient();
    const command = new PutObjectCommand(params);
    const result = await withRetry(() => r2Client.send(command));
    
    // Generate the public URL
    const publicUrl = getPublicUrl(key);
    
    logger.info(`File uploaded to R2: ${key} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
    
    return {
      key,
      url: publicUrl,
      etag: result.ETag,
      bucket: process.env.R2_BUCKET_NAME,
      size: fileSize
    };
  } catch (error) {
    logger.error(`Error uploading to R2: ${error.message}`);
    throw error;
  }
};

/**
 * Upload a large file using multipart upload
 * @param {Object} file - File object
 * @param {string} key - File key
 * @param {number} fileSize - File size in bytes
 * @returns {Promise<Object>} - Upload result
 */
const uploadLargeFile = async (file, key, fileSize) => {
  const r2Client = connectionPool.getClient();
  let uploadId;
  
  try {
    logger.info(`Starting multipart upload for large file: ${key} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
    
    // Create multipart upload
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: file.mimetype || 'application/octet-stream',
    });
    
    const multipartUpload = await withRetry(() => r2Client.send(createCommand));
    uploadId = multipartUpload.UploadId;
    
    // Read the entire file into memory first to ensure the entire file is available
    let fileBuffer;
    if (file.buffer) {
      fileBuffer = file.buffer;
    } else if (file.path) {
      fileBuffer = await fs.promises.readFile(file.path);
    } else {
      throw new Error('Invalid file object for multipart upload');
    }
    
    // Calculate part size and number of parts
    const PART_SIZE = 5 * 1024 * 1024; // 5MB parts
    const TOTAL_PARTS = Math.ceil(fileBuffer.length / PART_SIZE);
    
    logger.info(`Processing ${fileBuffer.length} bytes in ${TOTAL_PARTS} parts of ${PART_SIZE} bytes each`);
    
    // Upload each part sequentially to avoid race conditions
    const parts = [];
    for (let partNumber = 1; partNumber <= TOTAL_PARTS; partNumber++) {
      const start = (partNumber - 1) * PART_SIZE;
      const end = Math.min(start + PART_SIZE, fileBuffer.length);
      const partBuffer = fileBuffer.slice(start, end);
      
      // Upload the part
      const uploadPartCommand = new UploadPartCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
        Body: partBuffer
      });
      
      try {
        const result = await withRetry(() => r2Client.send(uploadPartCommand));
        
        parts.push({
          PartNumber: partNumber,
          ETag: result.ETag
        });
        
        // Log progress
        const progress = Math.min(100, Math.floor((partNumber / TOTAL_PARTS) * 100));
        if (partNumber % 5 === 0 || partNumber === TOTAL_PARTS) {
          logger.info(`Upload progress for ${key}: ${progress}% (part ${partNumber}/${TOTAL_PARTS})`);
        }
      } catch (error) {
        logger.error(`Error uploading part ${partNumber} for ${key}: ${error.message}`);
        
        // Abort the multipart upload
        try {
          const abortCommand = new AbortMultipartUploadCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            UploadId: uploadId
          });
          
          await r2Client.send(abortCommand);
          logger.info(`Aborted multipart upload for ${key} due to part upload failure`);
        } catch (abortError) {
          logger.error(`Failed to abort multipart upload: ${abortError.message}`);
        }
        
        throw error;
      }
    }
    
    // Verify we have all parts before completing
    if (parts.length !== TOTAL_PARTS) {
      throw new Error(`Expected ${TOTAL_PARTS} parts but got ${parts.length}`);
    }
    
    // Sort parts by part number to ensure correct order
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    
    // Complete the multipart upload
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts }
    });
    
    const result = await withRetry(() => r2Client.send(completeCommand));
    
    // Generate the public URL
    const publicUrl = getPublicUrl(key);
    
    logger.info(`Multipart upload completed for ${key} with ${parts.length} parts`);
    
    return {
      key,
      url: publicUrl,
      etag: result.ETag,
      bucket: process.env.R2_BUCKET_NAME,
      size: fileSize
    };
  } catch (error) {
    logger.error(`Error during multipart upload: ${error.message}`);
    
    // Try to abort the multipart upload if it was created
    if (uploadId) {
      try {
        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          UploadId: uploadId
        });
        
        await r2Client.send(abortCommand);
        logger.info(`Aborted multipart upload for ${key}`);
      } catch (abortError) {
        logger.error(`Failed to abort multipart upload: ${abortError.message}`);
      }
    }
    
    throw error;
  }
};

/**
 * Get a public URL for a file in R2
 * @param {string} key - File key in R2
 * @returns {string} - Public URL
 */
const getPublicUrl = (key) => {
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  // Use the public R2.dev URL format instead of direct storage URL
  return `https://pub-${process.env.ACCOUNT_ID}.r2.dev/${key}`;
};

/**
 * Check if a file exists in R2
 * @param {string} key - File key in R2
 * @returns {Promise<boolean>} - True if file exists
 */
const fileExists = async (key) => {
  try {
    const r2Client = connectionPool.getClient();
    const command = new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    });
    await withRetry(() => r2Client.send(command));
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
};

/**
 * Delete a file from R2
 * @param {string} key - File key in R2
 * @returns {Promise<Object>} - Deletion result
 */
const deleteFile = async (key) => {
  try {
    const r2Client = connectionPool.getClient();
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    });
    const result = await withRetry(() => r2Client.send(command));
    
    logger.info(`File deleted from R2: ${key}`);
    return result;
  } catch (error) {
    logger.error(`Error deleting from R2: ${error.message}`);
    throw error;
  }
};

module.exports = {
  uploadFile,
  getPublicUrl,
  fileExists,
  deleteFile
}; 
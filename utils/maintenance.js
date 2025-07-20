const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const r2Storage = require('./r2Storage');
const fileHelper = require('./fileHelper');
const Separation = require('../models/separation');
const mongoose = require('mongoose');

/**
 * Maintenance utility for the audio separator system
 * Handles cleanup of temporary files, database optimization, and system monitoring
 */
class MaintenanceUtil {
  /**
   * Clean up temporary local files older than a specified age
   * @param {number} maxAgeHours - Maximum age in hours for files to keep
   * @returns {Promise<Object>} - Information about cleaned files
   */
  async cleanLocalTemp(maxAgeHours = process.env.CLEANUP_TEMP_FILES_MAX_AGE || 24) {
    try {
      // Convert maxAgeHours to a number if it's a string
      maxAgeHours = parseInt(maxAgeHours);
      
      const uploadsDir = process.env.STORAGE_PATH || path.join(__dirname, '../uploads');
      const currentTime = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      
      logger.info(`Starting cleanup of temporary files older than ${maxAgeHours} hours`);
      
      // Get all files in the uploads directory and subdirectories
      const files = await this.getAllFiles(uploadsDir);
      
      let deletedCount = 0;
      let deletedSize = 0;
      
      for (const filePath of files) {
        try {
          const stats = await fs.stat(filePath);
          
          // Skip directories, only clean files
          if (!stats.isFile()) continue;
          
          // Check if file is older than max age
          const fileAge = currentTime - stats.mtimeMs;
          
          if (fileAge > maxAgeMs) {
            // Get file size before deleting
            const fileSize = stats.size;
            
            // Delete the file
            await fs.unlink(filePath);
            
            deletedCount++;
            deletedSize += fileSize;
            
            logger.info(`Deleted old file: ${path.basename(filePath)} (${(fileSize / 1024 / 1024).toFixed(2)}MB, ${(fileAge / (1000 * 60 * 60)).toFixed(1)} hours old)`);
          }
        } catch (fileError) {
          logger.error(`Error processing file ${filePath}: ${fileError.message}`);
        }
      }
      
      logger.info(`Temp file cleanup completed: Deleted ${deletedCount} files (${(deletedSize / 1024 / 1024).toFixed(2)}MB)`);
      
      return {
        deletedCount,
        deletedSize,
        unit: 'bytes'
      };
    } catch (error) {
      logger.error(`Error cleaning temporary files: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean all files from the uploads folder immediately
   * Use this after processing is complete
   * @returns {Promise<Object>} - Information about cleaned files
   */
  async cleanUploadsFolder() {
    try {
      const uploadsDir = process.env.STORAGE_PATH || path.join(__dirname, '../uploads');
      
      logger.info('Starting complete cleanup of uploads folder');
      
      // Get all files in the uploads directory and subdirectories
      const files = await this.getAllFiles(uploadsDir);
      
      let deletedCount = 0;
      let deletedSize = 0;
      
      for (const filePath of files) {
        try {
          const stats = await fs.stat(filePath);
          
          // Skip directories, only clean files
          if (!stats.isFile()) continue;
          
          // Get file size before deleting
          const fileSize = stats.size;
          
          // Delete the file
          await fs.unlink(filePath);
          
          deletedCount++;
          deletedSize += fileSize;
          
          logger.info(`Deleted upload file: ${path.basename(filePath)} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
        } catch (fileError) {
          logger.error(`Error deleting file ${filePath}: ${fileError.message}`);
        }
      }
      
      // Also try to clean empty directories
      try {
        await this.cleanEmptyDirectories(uploadsDir);
      } catch (dirError) {
        logger.error(`Error cleaning empty directories: ${dirError.message}`);
      }
      
      logger.info(`Uploads folder cleanup completed: Deleted ${deletedCount} files (${(deletedSize / 1024 / 1024).toFixed(2)}MB)`);
      
      return {
        deletedCount,
        deletedSize,
        unit: 'bytes'
      };
    } catch (error) {
      logger.error(`Error cleaning uploads folder: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Helper method to get all files recursively in a directory
   * @param {string} dir - Directory to scan
   * @returns {Promise<string[]>} - Array of file paths
   */
  async getAllFiles(dir) {
    const files = await fs.readdir(dir);
    const allFiles = [];
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        // Recursively get files in subdirectory
        const subDirFiles = await this.getAllFiles(filePath);
        allFiles.push(...subDirFiles);
      } else {
        allFiles.push(filePath);
      }
    }
    
    return allFiles;
  }
  
  /**
   * Helper method to clean empty directories recursively
   * @param {string} dir - Directory to clean
   */
  async cleanEmptyDirectories(dir) {
    const files = await fs.readdir(dir);
    
    // Process each item in the directory
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isDirectory()) {
        // Recursively clean subdirectory
        await this.cleanEmptyDirectories(filePath);
        
        // Check if directory is now empty and delete if it is
        const remainingFiles = await fs.readdir(filePath);
        if (remainingFiles.length === 0) {
          await fs.rmdir(filePath);
          logger.info(`Removed empty directory: ${filePath}`);
        }
      }
    }
  }
  
  /**
   * Clean up database records and associated files for old separations
   * @param {number} maxAgeDays - Maximum age in days for records to keep
   * @returns {Promise<Object>} - Information about cleaned records
   */
  async cleanOldSeparations(maxAgeDays = process.env.CLEANUP_OLD_JOBS_MAX_AGE || 30) {
    try {
      // Convert maxAgeDays to a number if it's a string
      maxAgeDays = parseInt(maxAgeDays);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
      
      logger.info(`Starting cleanup of separation jobs older than ${maxAgeDays} days (before ${cutoffDate.toISOString()})`);
      
      // Find old records
      const oldSeparations = await Separation.find({
        createdAt: { $lt: cutoffDate }
      });
      
      logger.info(`Found ${oldSeparations.length} old separation records to clean up`);
      
      let deletedCount = 0;
      
      for (const separation of oldSeparations) {
        try {
          // Delete associated files if they exist
          if (separation.storageType === 'r2' && separation.r2Key) {
            try {
              await r2Storage.deleteFile(separation.r2Key);
              logger.info(`Deleted R2 file: ${separation.r2Key}`);
            } catch (r2Error) {
              logger.error(`Failed to delete R2 file ${separation.r2Key}: ${r2Error.message}`);
            }
          } else if (separation.storageType === 'local' && separation.filePath) {
            try {
              // Check if file exists before trying to delete
              await fs.access(separation.filePath);
              await fs.unlink(separation.filePath);
              logger.info(`Deleted local file: ${separation.filePath}`);
            } catch (fsError) {
              // File may not exist, that's ok
              logger.warn(`Could not access local file ${separation.filePath}: ${fsError.message}`);
            }
          }
          
          // Delete the record
          await separation.remove();
          deletedCount++;
          
          logger.info(`Deleted separation record: ${separation._id}`);
        } catch (sepError) {
          logger.error(`Error cleaning up separation ${separation._id}: ${sepError.message}`);
        }
      }
      
      logger.info(`Separation cleanup completed: Deleted ${deletedCount}/${oldSeparations.length} records`);
      
      return {
        totalFound: oldSeparations.length,
        deletedCount
      };
    } catch (error) {
      logger.error(`Error cleaning old separations: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Clean jobs from the processing queue
   * @returns {Promise<Object>} - Information about cleaned jobs
   */
  async cleanupQueue() {
    try {
      logger.info('Starting Redis queue cleanup using smart queue service');
      
      // Use the smart queue service for cleanup
      const smartQueueService = require('../services/smartQueueService');
      
      // Smart queue service has its own automatic cleanup, just trigger it
      const stats = await smartQueueService.getQueueStatistics();
      
      logger.info(`Queue cleanup completed. Current queue stats:`, stats);
      
      return {
        message: 'Smart queue service manages its own cleanup automatically',
        currentStats: stats
      };
    } catch (error) {
      logger.error(`Error cleaning queue: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Run database maintenance operations
   * @returns {Promise<Object>} - Status information
   */
  async dbMaintenance() {
    try {
      logger.info('Starting database maintenance');
      
      // Get db stats before
      const statsBefore = await mongoose.connection.db.stats();
      
      // Run compact command if supported by the provider
      try {
        await mongoose.connection.db.command({ compact: 'separations' });
        logger.info('Compacted separations collection');
      } catch (compactError) {
        logger.warn(`Could not compact collection: ${compactError.message}`);
      }
      
      // Run repair command if supported
      try {
        await mongoose.connection.db.command({ repairDatabase: 1 });
        logger.info('Repaired database');
      } catch (repairError) {
        logger.warn(`Could not repair database: ${repairError.message}`);
      }
      
      // Get db stats after
      const statsAfter = await mongoose.connection.db.stats();
      
      const result = {
        sizeBefore: statsBefore.dataSize,
        sizeAfter: statsAfter.dataSize,
        difference: statsBefore.dataSize - statsAfter.dataSize
      };
      
      logger.info(`Database maintenance completed: Size before=${result.sizeBefore}, after=${result.sizeAfter}, difference=${result.difference}`);
      
      return result;
    } catch (error) {
      logger.error(`Error performing database maintenance: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Run all maintenance tasks
   * @returns {Promise<Object>} - Results from all maintenance operations
   */
  async runAll() {
    const results = {
      tempCleanup: null,
      separationsCleanup: null,
      queueCleanup: null,
      dbMaintenance: null,
      errors: []
    };
    
    try {
      // Clean temporary files
      try {
        results.tempCleanup = await this.cleanLocalTemp();
      } catch (error) {
        results.errors.push(`Temp cleanup error: ${error.message}`);
      }
      
      // Clean old separations
      try {
        results.separationsCleanup = await this.cleanOldSeparations();
      } catch (error) {
        results.errors.push(`Separations cleanup error: ${error.message}`);
      }
      
      // Clean queue using smart queue service
      try {
        results.queueCleanup = await this.cleanupQueue();
      } catch (error) {
        results.errors.push(`Queue cleanup error: ${error.message}`);
      }
      
      // Database maintenance
      try {
        results.dbMaintenance = await this.dbMaintenance();
      } catch (error) {
        results.errors.push(`DB maintenance error: ${error.message}`);
      }
      
      logger.info('All maintenance tasks completed');
      return results;
    } catch (error) {
      logger.error(`Error in maintenance runAll: ${error.message}`);
      results.errors.push(`General error: ${error.message}`);
      return results;
    }
  }
}

module.exports = new MaintenanceUtil(); 
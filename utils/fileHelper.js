const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("./logger");
const r2Storage = require("./r2Storage");

/**
 * Generate a unique filename for uploaded files
 * @param {string} originalname - Original filename
 * @returns {string} - Unique filename
 */
function generateUniqueFilename(originalname) {
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(8).toString("hex");
  const ext = path.extname(originalname);
  const safeName = path
    .basename(originalname, ext)
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();

  return `${safeName}-${timestamp}-${randomStr}${ext}`;
}

/**
 * Generate a public URL for an uploaded file (using R2 or local storage)
 * @param {string} filename - Filename or R2 key
 * @returns {string} - Public URL
 */
function getPublicFileUrl(filename) {
  if (process.env.STORAGE_TYPE === "r2") {
    return r2Storage.getPublicUrl(filename);
  } else {
    // Fallback to local storage URLs
    const host =
      process.env.PUBLIC_HOST || `http://localhost:${process.env.PORT || 5000}`;
    return `${host}/static/${filename}`;
  }
}

/**
 * Save file to storage (R2 or local)
 * @param {Object} file - Multer file object
 * @param {string} destinationDir - Destination directory (for local storage)
 * @returns {Object} - File information
 */
async function saveFile(
  file,
  destinationDir = process.env.STORAGE_PATH || "./uploads"
) {
  try {
    const uniqueFilename = generateUniqueFilename(file.originalname);

    // If using R2 storage
    if (process.env.STORAGE_TYPE === "r2") {
      const key = `uploads/audio/${uniqueFilename}`;

      // Upload to R2
      const r2Result = await r2Storage.uploadFile(file, key);

      return {
        originalFilename: file.originalname,
        storedFilename: uniqueFilename,
        filePath: key, // Store the R2 key as the file path
        fileSize: file.size,
        mimeType: file.mimetype,
        publicUrl: r2Result.url,
        r2Key: key,
        storageType: "r2",
      };
    }
    // Else use local storage
    else {
      // Create directory if it doesn't exist
      if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true });
      }

      const destination = path.join(destinationDir, uniqueFilename);
      // If file was uploaded to temp location, move it
      if (file.path) {
        await fs.promises.copyFile(file.path, destination);
        await fs.promises.unlink(file.path);
      }

      const publicUrl = getPublicFileUrl(uniqueFilename);

      return {
        originalFilename: file.originalname,
        storedFilename: uniqueFilename,
        filePath: destination,
        fileSize: file.size,
        mimeType: file.mimetype,
        publicUrl,
        storageType: "local",
      };
    }
  } catch (error) {
    logger.error(`Error saving file ${file.originalname}: ${error.message}`);
    throw error;
  }
}

/**
 * Remove a file from storage (R2 or local)
 * @param {string} filePath - Path to file or R2 key
 * @param {string} storageType - Type of storage ('r2' or 'local')
 * @returns {boolean} - Success status
 */
async function removeFile(filePath, storageType = process.env.STORAGE_TYPE) {
  try {
    if (storageType === "r2") {
      // Assume filePath is the R2 key
      await r2Storage.deleteFile(filePath);
      return true;
    } else {
      // Local file
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    }
  } catch (error) {
    logger.error(`Error removing file ${filePath}: ${error.message}`);
    return false;
  }
}

module.exports = {
  saveFile,
  removeFile,
  generateUniqueFilename,
  getPublicFileUrl,
};
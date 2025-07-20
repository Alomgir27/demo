const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const separationController = require('../controllers/separationController');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');


// Set up multer for file uploads
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Choose storage strategy based on configuration
let storage;
if (process.env.STORAGE_TYPE === 'r2') {
  // For R2 storage, use memory storage for better streaming to R2
  logger.info('Using memory storage for multer (R2 mode)');
  storage = multer.memoryStorage();
} else {
  // For local storage, use disk storage
  logger.info('Using disk storage for multer (local mode)');
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });
}

// Maximum file size: default 500MB, can be configured in environment
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || 500) * 1024 * 1024;
logger.info(`Maximum file upload size set to ${MAX_FILE_SIZE / (1024 * 1024)}MB`);

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/flac', 'audio/m4a', 'audio/aac',
      'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      logger.warn(`Invalid file type rejected: ${file.mimetype} from ${req.ip}`);
      cb(new Error(`Unsupported file type: ${file.mimetype}. Please upload audio or video files.`), false);
    }
  }
});

// Routes

// File upload (used by frontend) - with authentication and limit checking
router.post('/upload',
  auth.addUserIfTokenExists,
  upload.single('file'),
  separationController.uploadFile
);

// URL processing (used by frontend) - with authentication
router.post('/process-url',
  auth.addUserIfTokenExists,
  separationController.processUrl
);

// Get status (used by frontend)
router.get('/:id/status', auth.addUserIfTokenExists, separationController.getStatus);

// Get user quota status
router.get('/quota', auth.addUserIfTokenExists, separationController.getUserQuota);



module.exports = router; 
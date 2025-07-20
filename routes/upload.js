const express = require('express');
const router = express.Router();
const { generateUploadUrl } = require('../controllers/fileController');

// Route to get pre-signed URL for file upload
router.post('/url', generateUploadUrl);

module.exports = router; 
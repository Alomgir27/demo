const mongoose = require('mongoose');

const SeparationSchema = new mongoose.Schema({
  originalFilename: {
    type: String,
    required: true
  },
  storedFilename: {
    type: String,
    required: true
  },
  fileSize: { // in bytes
    type: Number,
    required: true
  },
  fileDuration: { // in seconds
    type: Number,
    required: false,
    default: 0
  },
  filePath: {
    type: String,
    required: true
  },
  publicUrl: {
    type: String,
    required: true
  },
  // Storage type: 'file', 'url'
  storageType: {
    type: String,
    enum: ['file', 'url'],
    required: true
  },
  // R2 key for files stored in Cloudflare R2
  r2Key: {
    type: String,
    required: false
  },
  // Updated status flow: UPLOADING → UPLOADED → VALIDATING → VALIDATED → QUEUED → PROCESSING → COMPLETE
  status: {
    type: String,
    required: true,
    enum: ['UPLOADING', 'UPLOADED', 'VALIDATING', 'VALIDATED', 'QUEUED', 'PROCESSING', 'COMPLETE', 'FAILED'],
    default: 'UPLOADING'
  },
  // Detailed processing message from RunPod API
  processingMessage: {
    type: String,
    required: false
  },
  // RunPod job ID for tracking/monitoring
  runpodJobId: {
    type: String,
    required: false
  },
  vocalUrl: {
    type: String,
    required: false
  },
  instrumentalUrl: {
    type: String,
    required: false
  },
  errorMessage: {
    type: String,
    required: false
  },
  executionTime: {
    type: Number,
    required: false
  },
  delayTime: {
    type: Number,
    required: false
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  creditsDeducted: {
    type: Boolean,
    default: false,
    required: true
  }
});

// Update the 'updatedAt' field on save
SeparationSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Separation', SeparationSchema); 
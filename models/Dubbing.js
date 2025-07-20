const mongoose = require("mongoose");

const dubbingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  audio_id: {
    type: String,
    required: true,
    unique: true,
  },
  project_title: {
    type: String,
    default: "Untitled project",
  },
  source_language: {
    type: String,
    default: "Auto Detect",
  },
  target_language: {
    type: String,
    default: "English",
  },
  speakers: {
    type: Number,
    default: 1,
  },
  fileDuration: {
    type: Number,
    default: 0,
  },
  startTime: {
    type: Number,
    default: 0,
  },
  endTime: {
    type: Number,
    default: 0,
  },
  mediaType: {
    type: String,
    enum: ["audio", "video"],
    default: "audio",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Dubbing", dubbingSchema);

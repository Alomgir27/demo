const Dubbing = require("../models/Dubbing");

exports.saveAudioId = async (req, res) => {
  const {
    audio_id,
    project_title,
    source_language,
    target_language,
    speakers,
    fileDuration,
    startTime,
    endTime,
    mediaType,
  } = req.body;

  const newDubbing = new Dubbing({
    user: req.user.id,
    audio_id,
    project_title,
    source_language,
    target_language,
    speakers,
    fileDuration: fileDuration || 0,
    startTime: startTime || 0,
    endTime: endTime || fileDuration || 0,
    mediaType: mediaType || "audio",
  });
  
  await newDubbing.save();

  res.status(201).json({
    message: "Dubbing saved successfully",
    data: newDubbing,
  });
};

exports.dubbingHistory = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const total = await Dubbing.countDocuments({ user: req.user.id });
  const history = await Dubbing.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({
    message: "Dubbing history fetched successfully",
    data: history,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
};

exports.deleteDubbing = async (req, res) => {
  const audio_id = req.params.audio_id;

  await Dubbing.findOneAndDelete({
    user: req.user.id,
    audio_id: audio_id,
  });

  res.status(200).json({
    message: "Dubbing deleted successfully",
  });
};

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const dubbingController = require("../controllers/dubbingController");

router.post("/", auth.protect, dubbingController.saveAudioId);

router.get("/history", auth.protect, dubbingController.dubbingHistory);

router.delete(
  "/delete/:audio_id",
  auth.protect,
  dubbingController.deleteDubbing
);

module.exports = router;

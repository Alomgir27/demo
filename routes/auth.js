const express = require("express");
const router = express.Router();
const passport = require("passport");
const authController = require("../controllers/authController");
const auth = require("../middleware/auth");
const validatePasswordMiddleware = require("../middleware/validatePassword");

// Register a new user
router.post("/register", validatePasswordMiddleware, authController.register);

// Login user
router.post("/login", authController.login);

// Google OAuth routes
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Google OAuth callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/login",
  }),
  authController.googleCallback
);

// Get current user profile
router.get("/profile", auth.protect, authController.getProfile);

// Update user profile
router.put("/profile", auth.protect, authController.updateProfile);

router.post("/forgot-password", authController.requestPasswordReset);
router.get("/reset-password/:token", authController.resetPasswordTokenCheck);
router.post("/reset-password/:token", authController.resetPassword);

router.get("/verify-email/:token", authController.verifyEmail);

module.exports = router;

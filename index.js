require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/database");
const logger = require("./utils/logger");
const maintenance = require("./utils/maintenance");
const passport = require("./config/passport");
const { initPricingPlans } = require("./utils/initData");
require("./services/smartQueueService");

// Routes
const separationRoutes = require("./routes/separation");
const authRoutes = require("./routes/auth");
const stripeRoutes = require("./routes/stripe");
const uploadRoutes = require("./routes/upload");
const dubbingRoutes = require("./routes/dubbing");

// =====================
// Utility Functions
// =====================
function ensureUploadsDir() {
  const uploadsDir = path.join(__dirname, "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

function gracefulShutdown() {
  logger.info("Shutting down gracefully...");
  setTimeout(() => {
    logger.info("Shutting down complete");
    process.exit(0);
  }, 1000);
}

// =====================
// Express App
// =====================
const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy
app.set("trust proxy", 1);

// Database connection
connectDB()
  .then(async () => {
    await initPricingPlans();
  })
  .catch((err) => {
    logger.error(`Failed to initialize data: ${err.message}`);
  });

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes",
  trustProxy: true,
});

// Middleware
app.use(compression());
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins =
        process.env.NODE_ENV === "production"
          ? [
              "https://clearvocals.ai",
              "https://www.clearvocals.ai",
              process.env.FRONTEND_URL,
            ].filter(Boolean)
          : [
              "http://localhost:3000",
              "http://127.0.0.1:3000",
              "https://clearvocals.ai",
              "https://www.clearvocals.ai",
            ];

      // Allow requests with no origin (mobile apps, curl, etc)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("CORS blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-fingerprint",
      "X-File-Info",
      "X-Fingerprint",
      "Accept",
      "Origin",
      "X-Requested-With",
      "Cache-Control",
      "DNT",
      "If-Modified-Since",
      "Keep-Alive",
      "User-Agent",
    ],
  })
);
// Special handling for Stripe webhook
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Passport
app.use(passport.initialize());

// Static files
app.use("/static", express.static(path.join(__dirname, "uploads")));

// Routes
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/", (req, res) => res.send("Clear Vocals API is running"));

// API routes with rate limiting
app.use("/api/separation", apiLimiter, separationRoutes);
app.use("/api/auth", apiLimiter, authRoutes);
app.use("/api/stripe", apiLimiter, stripeRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/dubbing", dubbingRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    details: `The requested endpoint ${req.originalUrl} does not exist`,
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: `File too large. Maximum size is ${
          process.env.MAX_FILE_SIZE || 100
        }MB`,
      });
    }
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({
    error: "Server error",
    details:
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : err.message,
  });
});

// =====================
// Start Server
// =====================
ensureUploadsDir();

app.listen(PORT, "0.0.0.0", () => {
  logger.info(`Server started on port ${PORT}`);
});

// Error handlers
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  if (process.env.NODE_ENV === "production") {
    gracefulShutdown();
  } else {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

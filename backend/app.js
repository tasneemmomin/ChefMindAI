import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import authRoutes from "./routes/auth.js";
import recipeRoutes from "./routes/recipeRoutes.js";
import ingredientRoutes from "./routes/ingredientRoutes.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { getLLMStats } from "./services/llmGateway.js";

const app = express();

// Trust reverse proxy in production or when configured so rate limiting uses true client IP
if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// Standard Security & CORS middleware (zero external dependency)
app.use((req, res, next) => {
  const clientUrlEnv = process.env.CLIENT_URL;
  let allowedOrigin = "*";

  if (clientUrlEnv) {
    const allowedList = clientUrlEnv
      .split(",")
      .map((u) => u.trim().replace(/\/+$/, ""))
      .filter(Boolean);

    const requestOrigin = (req.headers.origin || "").replace(/\/+$/, "");

    if (requestOrigin && allowedList.includes(requestOrigin)) {
      allowedOrigin = req.headers.origin;
      res.setHeader("Vary", "Origin");
    } else if (allowedList.length > 0) {
      allowedOrigin = allowedList[0];
    }
  }

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// JSON body parser with size limit to prevent payload flooding
app.use(express.json({ limit: "1mb" }));

// Health and readiness endpoints (unthrottled for cloud platform and load balancer probes)
const getHealthStatus = (req, res) => {
  const isDbReady = mongoose.connection.readyState === 1;
  res.status(200).json({
    success: true,
    status: "healthy",
    uptime: Math.floor(process.uptime()),
    services: {
      database: isDbReady ? "connected" : "disconnected",
    },
    timestamp: new Date().toISOString(),
  });
};

const getReadinessStatus = (req, res) => {
  const isDbReady = mongoose.connection.readyState === 1;
  const statusCode = isDbReady ? 200 : 503;
  res.status(statusCode).json({
    success: isDbReady,
    status: isDbReady ? "ready" : "not_ready",
    uptime: Math.floor(process.uptime()),
    services: {
      database: isDbReady ? "connected" : "disconnected",
    },
    timestamp: new Date().toISOString(),
  });
};

app.get("/health", getHealthStatus);
app.get("/health/ready", getReadinessStatus);
app.get("/api/health", getHealthStatus);
app.get("/api/health/ready", getReadinessStatus);

// LLM gateway observability (per-model latency, tokens, failures, circuit state).
// Disabled unless LLM_STATS_TOKEN is set; callers must send it as a Bearer token.
app.get("/api/health/ai", apiLimiter, (req, res) => {
  const statsToken = process.env.LLM_STATS_TOKEN?.trim();
  const provided = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!statsToken) {
    return res.status(404).json({ success: false, message: "Not found." });
  }
  const expected = Buffer.from(statsToken);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  return res.json({ success: true, ...getLLMStats(), timestamp: new Date().toISOString() });
});

// General API Rate Limiting on /api
app.use("/api", apiLimiter);

// Base endpoints
app.get("/", (req, res) => {
  res.send("Welcome to ChefMind AI!");
});

// MVC Routes
app.use("/api/auth", authRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/ingredients", ingredientRoutes);

// 404 Route Not Found handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.originalUrl} not found.`,
  });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  // Handle Multer upload errors
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File is too large. Maximum allowed size is 5 MB.",
      });
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: "Too many files uploaded. Maximum allowed is 5 images.",
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message || "File upload error.",
    });
  }

  // Handle Multer fileFilter custom error
  if (err.message && err.message.includes("Only JPG, PNG, and WebP images are allowed")) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  // Handle malformed JSON request body
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({
      success: false,
      message: "Malformed JSON payload.",
    });
  }

  // Handle Mongoose CastError (e.g. invalid ObjectId)
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid resource identifier format.",
    });
  }

  // Handle other server errors
  console.error("Server error:", err.message);
  return res.status(err.status || 500).json({
    success: false,
    message: err.status ? err.message : "An unexpected server error occurred.",
  });
});

export default app;

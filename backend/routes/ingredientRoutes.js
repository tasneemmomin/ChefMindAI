import express from "express";
import {
  handleTextIngredients,
  handleImageUpload,
  analyzeImage,
} from "../controllers/ingredientController.js";
import { upload } from "../middleware/upload.js";
import { authenticateToken } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// Allow text validation as utility
router.post("/text", handleTextIngredients);
router.post("/image", authenticateToken, upload.single("image"), handleImageUpload);

// Protect image vision analysis with JWT authentication and AI rate limiting
router.post(
  "/image-analyze",
  authenticateToken,
  aiLimiter,
  upload.array("images", 5),
  analyzeImage
);

export default router;

import { analyzeImageIngredients } from "../services/aiService.js";

/**
 * Validate and echo plain text ingredients.
 */
export function handleTextIngredients(req, res) {
  const { ingredients } = req.body;

  if (!ingredients || typeof ingredients !== "string" || !ingredients.trim()) {
    return res.status(400).json({
      success: false,
      message: "Please provide your ingredients.",
    });
  }

  return res.json({
    success: true,
    inputType: "text",
    ingredients: ingredients.trim(),
    message: "Ingredients received successfully!",
  });
}

/**
 * Handle direct image receipt metadata.
 */
export function handleImageUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please upload an image.",
    });
  }

  if (!validateImageContent(req.file.buffer)) {
    return res.status(400).json({
      success: false,
      message: "Uploaded file does not contain valid image data. Only authentic JPG, PNG, and WebP images are permitted.",
    });
  }

  return res.json({
    success: true,
    inputType: "image",
    filename: req.file.originalname,
    size: req.file.size,
    contentType: req.file.mimetype,
    message: "Image received successfully!",
  });
}

const MAX_INDIVIDUAL_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_COMBINED_SIZE = 15 * 1024 * 1024;  // 15 MB
const MAX_IMAGE_COUNT = 5;

/**
 * Validate that a buffer matches valid JPEG, PNG, or WebP binary magic signatures.
 */
function validateImageContent(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false;
  }

  // JPEG: starts with 0xFF, 0xD8, 0xFF
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) return true;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (isPng) return true;

  // WebP: offset 0..3 'RIFF' and offset 8..11 'WEBP'
  const isRiff =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46;
  const isWebp =
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;
  if (isRiff && isWebp) return true;

  return false;
}

/**
 * Sanitizes error messages to protect sensitive environment variables, internal paths, and secrets.
 */
function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== "string") {
    return "Failed to analyze the uploaded images.";
  }
  if (
    msg.includes("GEMINI_API_KEY") ||
    msg.includes("GROQ_API_KEY") ||
    msg.toLowerCase().includes("api key")
  ) {
    return "AI vision service is not properly configured. Please contact support.";
  }
  let clean = msg.replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED]");
  clean = clean.replace(/gsk_[0-9A-Za-z_-]{40,60}/g, "[REDACTED]");
  clean = clean.replace(/\/[a-zA-Z0-9_\-./]+\.(js|json|env)/g, "[internal file]");
  return clean;
}

/**
 * Analyze uploaded ingredient photos using Gemini AI vision.
 */
export async function analyzeImage(req, res) {
  try {
    const files = req.files || (req.file ? [req.file] : []);

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please upload at least one image.",
      });
    }

    if (files.length > MAX_IMAGE_COUNT) {
      return res.status(400).json({
        success: false,
        message: `Too many files uploaded. Maximum allowed is ${MAX_IMAGE_COUNT} images.`,
      });
    }

    let totalSize = 0;
    for (const file of files) {
      if (!file.buffer || file.size > MAX_INDIVIDUAL_SIZE) {
        return res.status(400).json({
          success: false,
          message: "Individual image size cannot exceed 5 MB.",
        });
      }

      totalSize += file.size;

      if (!validateImageContent(file.buffer)) {
        return res.status(400).json({
          success: false,
          message: `File '${file.originalname || "upload"}' does not contain valid image data. Only authentic JPG, PNG, and WebP images are permitted.`,
        });
      }
    }

    if (totalSize > MAX_COMBINED_SIZE) {
      return res.status(400).json({
        success: false,
        message: "Combined image size exceeds the 15 MB limit.",
      });
    }

    const imagePayloads = files.map((file) => ({
      buffer: file.buffer,
      mimetype: file.mimetype,
    }));

    const analysis = await analyzeImageIngredients(imagePayloads);

    return res.json({
      success: true,
      ...analysis,
    });
  } catch (error) {
    console.error("Image analysis failed:", error.message);

    const safeMessage = sanitizeErrorMessage(error.message);

    return res.status(500).json({
      success: false,
      message: safeMessage,
    });
  } finally {
    if (req.files && Array.isArray(req.files)) {
      for (const f of req.files) {
        f.buffer = null;
      }
    }
  }
}
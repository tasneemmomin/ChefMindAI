import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

import app from "./app.js";
import { connectDB } from "./db.js";

/**
 * Validates presence of essential environment variables before binding server ports.
 */
export function validateEnvironment(env = process.env) {
  const required = ["MONGODB_URI", "JWT_SECRET", "GEMINI_API_KEY"];
  const missing = required.filter((key) => !env[key] || !env[key].trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (env.NODE_ENV === "production" && env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long in production.");
  }
}

const port = process.env.PORT || 3000;

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("server.js") ||
  process.argv[1].endsWith("server")
);

if (isMainModule) {
  try {
    validateEnvironment();
  } catch (envErr) {
    console.error("Environment configuration error:", envErr.message);
    process.exit(1);
  }

  connectDB().then(() => {
    app.listen(port, () => {
      console.log(`ChefMind AI server is running on port ${port}`);
    });
  }).catch((err) => {
    console.error("Failed to start server due to database connection error:", err.message);
    process.exit(1);
  });
}
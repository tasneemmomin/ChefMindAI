/**
 * API Configuration Module
 *
 * Resolves API endpoints against the configured base URL.
 * - In local development: defaults to "" so Vite's dev proxy forwards "/api/*" to localhost:3000.
 * - In production: set VITE_API_BASE_URL (e.g., "https://chefmind-api.onrender.com") in your static hosting provider (Vercel, Netlify, Cloudflare Pages).
 *
 * NOTE: VITE_ prefixed variables are embedded in public client bundles. NEVER place secrets (e.g. GEMINI_API_KEY, JWT_SECRET, MONGODB_URI) in VITE_ variables.
 */

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

// Normalize base URL by removing any trailing slashes
export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, "");

/**
 * Builds a fully qualified API endpoint URL.
 * @param {string} endpoint - The relative API path (e.g. "/api/recipes" or "api/recipes").
 * @returns {string} The fully qualified or proxy-relative URL.
 */
export function buildApiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${API_BASE_URL}${cleanEndpoint}`;
}

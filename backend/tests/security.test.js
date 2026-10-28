import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import app from "../app.js";

function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("Security & CORS Headers: Responds with expected security and CORS headers", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(res.headers.get("x-frame-options"), "DENY");
    assert.ok(res.headers.get("access-control-allow-origin"));

    const data = await res.json();
    assert.strictEqual(data.success, true);
  } finally {
    await close();
  }
});

test("Security & CORS Headers: Preflight OPTIONS request returns 204", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/recipes`, {
      method: "OPTIONS",
      headers: {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.strictEqual(res.status, 204);
  } finally {
    await close();
  }
});

test("Error Handling: Non-existent endpoint returns structured 404", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/non-existent-route`);
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("not found"));
  } finally {
    await close();
  }
});

test("Error Handling: Malformed JSON body returns 400 Bad Request", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"invalidJson": ...',
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("JSON"));
  } finally {
    await close();
  }
});

test("Configuration Security: validateEnvironment validates required env variables and secret length", async () => {
  const { validateEnvironment } = await import("../server.js");

  // Missing MONGODB_URI
  assert.throws(
    () => validateEnvironment({ JWT_SECRET: "a".repeat(32), GEMINI_API_KEY: "key" }),
    /Missing required environment variables: MONGODB_URI/
  );

  // Missing JWT_SECRET
  assert.throws(
    () => validateEnvironment({ MONGODB_URI: "mongodb://localhost", GEMINI_API_KEY: "key" }),
    /Missing required environment variables: JWT_SECRET/
  );

  // Missing GEMINI_API_KEY
  assert.throws(
    () => validateEnvironment({ MONGODB_URI: "mongodb://localhost", JWT_SECRET: "a".repeat(32) }),
    /Missing required environment variables: GEMINI_API_KEY/
  );

  // Weak JWT_SECRET in production
  assert.throws(
    () =>
      validateEnvironment({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost",
        JWT_SECRET: "short-secret",
        GEMINI_API_KEY: "key",
      }),
    /JWT_SECRET must be at least 32 characters long in production/
  );

  // Valid environment passes
  assert.doesNotThrow(() =>
    validateEnvironment({
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://localhost",
      JWT_SECRET: "a".repeat(32),
      GEMINI_API_KEY: "valid-key",
    })
  );
});

test("Authentication Security: Rejects JWT with malformed or non-ObjectId userId payload", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const { baseUrl, close } = await startTestServer();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";

  try {
    // Non-ObjectId string userId
    const invalidPayloadToken = jwt.sign(
      { userId: "not-a-valid-mongo-id" },
      process.env.JWT_SECRET
    );

    const res = await fetch(`${baseUrl}/api/recipes`, {
      headers: { Authorization: `Bearer ${invalidPayloadToken}` },
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.message, "Invalid token payload. Please log in again.");

    // Missing token in Bearer header
    const resEmptyBearer = await fetch(`${baseUrl}/api/recipes`, {
      headers: { Authorization: "Bearer " },
    });
    assert.strictEqual(resEmptyBearer.status, 401);
  } finally {
    await close();
  }
});

test("Image Upload Security: /api/ingredients/image requires authentication and validates magic bytes", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const { baseUrl, close } = await startTestServer();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";
  const validToken = jwt.sign(
    { userId: "507f1f77bcf86cd799439011" },
    process.env.JWT_SECRET
  );

  try {
    // 1. Unauthenticated request to /image returns 401
    const resUnauth = await fetch(`${baseUrl}/api/ingredients/image`, {
      method: "POST",
    });
    assert.strictEqual(resUnauth.status, 401);

    // 2. Authenticated upload with spoofed text file masquerading as image returns 400
    const formData = new FormData();
    const fakeImage = new Blob(["NOT AN IMAGE BINARY DATA"], { type: "image/jpeg" });
    formData.append("image", fakeImage, "malicious.jpg");

    const resSpoofed = await fetch(`${baseUrl}/api/ingredients/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${validToken}` },
      body: formData,
    });
    assert.strictEqual(resSpoofed.status, 400);
    const dataSpoofed = await resSpoofed.json();
    assert.strictEqual(dataSpoofed.success, false);
    assert.match(dataSpoofed.message, /valid image data/);
  } finally {
    await close();
  }
});

test("Recipe Chat Security: Rejects invalid recipe._id format with 400 Bad Request", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const { baseUrl, close } = await startTestServer();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";
  const validToken = jwt.sign(
    { userId: "507f1f77bcf86cd799439011" },
    process.env.JWT_SECRET
  );

  try {
    const res = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        recipe: { _id: "malformed-id-not-objectid", title: "Test Dish" },
        message: "Can I replace salt?",
      }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.message, "Invalid recipe ID format.");
  } finally {
    await close();
  }
});

test("Error Sanitization Security: Sensitive API keys and internal file paths are redacted in error responses", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const { baseUrl, close } = await startTestServer();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";
  const validToken = jwt.sign(
    { userId: "507f1f77bcf86cd799439011" },
    process.env.JWT_SECRET
  );

  const originalFetch = globalThis.fetch;
  // Mock Gemini to return an error containing a simulated leaked API key and path
  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message:
              "API key not valid: AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6. Failure in /var/app/backend/server.js",
          },
        }),
      };
    }
    return originalFetch(url, options);
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        recipe: { title: "Test Dish" },
        message: "How much salt?",
      }),
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    // Key and file path must NOT be present in output
    assert.strictEqual(data.message.includes("AIzaSy"), false);
    assert.strictEqual(data.message.includes("/var/app/backend/server.js"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await close();
  }
});

test("Deployment Health Probes: /health and /api/health report liveness without leaking sensitive info", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    for (const endpoint of ["/health", "/api/health"]) {
      const res = await fetch(`${baseUrl}${endpoint}`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.status, "healthy");
      assert.ok(typeof data.uptime === "number");
      assert.ok(data.services?.database);
      assert.ok(data.timestamp);

      // Verify no sensitive credentials or internal paths leaked
      const rawText = JSON.stringify(data);
      assert.strictEqual(rawText.includes("mongodb"), false);
      assert.strictEqual(rawText.includes("password"), false);
      assert.strictEqual(rawText.includes("secret"), false);
    }
  } finally {
    await close();
  }
});

test("Deployment Readiness Probes: /health/ready reports database readiness status", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    for (const endpoint of ["/health/ready", "/api/health/ready"]) {
      const res = await fetch(`${baseUrl}${endpoint}`);
      // In isolated test without live DB, readyState is 0 (disconnected) -> returns 503 not_ready
      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.status, "not_ready");
      assert.strictEqual(data.services?.database, "disconnected");
    }
  } finally {
    await close();
  }
});

test("CORS Deployment: Multi-origin and trailing slash normalization", async () => {
  const originalClientUrl = process.env.CLIENT_URL;
  process.env.CLIENT_URL = "https://chefmind.vercel.app,https://chefmind-staging.vercel.app/";

  const { baseUrl, close } = await startTestServer();
  try {
    // Request from first allowed origin
    const res1 = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://chefmind.vercel.app" },
    });
    assert.strictEqual(res1.headers.get("access-control-allow-origin"), "https://chefmind.vercel.app");
    assert.strictEqual(res1.headers.get("vary"), "Origin");

    // Request from second allowed origin (without trailing slash in Origin header, matching the trailing-slashed env entry)
    const res2 = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://chefmind-staging.vercel.app" },
    });
    assert.strictEqual(res2.headers.get("access-control-allow-origin"), "https://chefmind-staging.vercel.app");

    // Request from disallowed origin defaults to primary configured origin
    const res3 = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://malicious-site.example.com" },
    });
    assert.strictEqual(res3.headers.get("access-control-allow-origin"), "https://chefmind.vercel.app");
  } finally {
    process.env.CLIENT_URL = originalClientUrl;
    await close();
  }
});

test("AI Provider Cascade: Groq failure seamlessly cascades to Gemini", async () => {
  const { default: jwt } = await import("jsonwebtoken");
  const { baseUrl, close } = await startTestServer();
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";
  process.env.GROQ_API_KEY = "gsk_testGroqKey1234567890abcdefghijklmnopqrstuvwxyz";
  process.env.GEMINI_API_KEY = "test-gemini-key";

  const validToken = jwt.sign(
    { userId: "507f1f77bcf86cd799439011" },
    process.env.JWT_SECRET
  );

  let groqCalled = false;
  let geminiCalled = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("api.groq.com")) {
      groqCalled = true;
      // Simulate Groq rate limit / overload
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: { message: "Rate limit reached for model on Groq" },
        }),
      };
    }
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      geminiCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      type: "answer",
                      message: "Gemini successfully answered the fallback request.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      };
    }
    return originalFetch(url, options);
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        recipe: { title: "Spaghetti Aglio e Olio" },
        message: "Can I use olive oil?",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(groqCalled, true);
    assert.strictEqual(geminiCalled, true);
    assert.strictEqual(data.response.type, "answer");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    await close();
  }
});




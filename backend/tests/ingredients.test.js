import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app.js";
import { validateVisionResponse } from "../services/aiService.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";
const testToken = jwt.sign({ userId: "507f1f77bcf86cd799439011" }, process.env.JWT_SECRET);

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

test("Ingredients Text API: Validates missing or empty ingredients string", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const emptyRes = await fetch(`${baseUrl}/api/ingredients/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients: "   " }),
    });
    assert.strictEqual(emptyRes.status, 400);
    const emptyData = await emptyRes.json();
    assert.strictEqual(emptyData.success, false);

    const validRes = await fetch(`${baseUrl}/api/ingredients/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients: "potato, onion" }),
    });
    assert.strictEqual(validRes.status, 200);
    const validData = await validRes.json();
    assert.strictEqual(validData.success, true);
    assert.strictEqual(validData.ingredients, "potato, onion");
  } finally {
    await close();
  }
});

const validJpegBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x00, 0x00]);
const validPngBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const validWebpBuffer = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);

const originalFetch = globalThis.fetch;

function mockGeminiResponse(candidateText, status = 200) {
  process.env.GEMINI_API_KEY = "mock-api-key-for-testing";
  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      if (status >= 400) {
        return {
          ok: false,
          status,
          json: async () => ({ error: { message: "Simulated Gemini vision API error" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: candidateText }],
              },
            },
          ],
        }),
      };
    }
    return originalFetch(url, options);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

test("Ingredients Image API: Requires authentication (401 without token)", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const formData = new FormData();
    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      body: formData,
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("Authentication required"));
  } finally {
    await close();
  }
});

test("Ingredients Image API: Rejects missing files with 400 Bad Request when authenticated", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const formData = new FormData();
    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("at least one image"));
  } finally {
    await close();
  }
});

test("Ingredients Image API: Rejects disallowed file types (.txt) with 400 Bad Request", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const formData = new FormData();
    const file = new File(["dummy text content"], "test.txt", { type: "text/plain" });
    formData.append("images", file);

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("Only JPG, PNG, and WebP images are allowed"));
  } finally {
    await close();
  }
});

test("Ingredients Image API: Rejects spoofed image files failing magic bytes check with 400", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const formData = new FormData();
    // File with image/jpeg mime type but plain text content
    const spoofedFile = new File(["hello plain text not an image"], "spoofed.jpg", { type: "image/jpeg" });
    formData.append("images", spoofedFile);

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("does not contain valid image data"));
  } finally {
    await close();
  }
});

test("Ingredients Image API: Rejects individual file exceeding 5MB limit with 400 Bad Request", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const formData = new FormData();
    const largeBuffer = new Uint8Array(6 * 1024 * 1024);
    const file = new File([largeBuffer], "huge.jpg", { type: "image/jpeg" });
    formData.append("images", file);

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("5 MB"));
  } finally {
    await close();
  }
});

test("Ingredients Image API: Rejects combined uploads exceeding 15 MB limit with 400 Bad Request", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const formData = new FormData();
    // 4 files each 4MB = 16MB > 15MB
    for (let i = 0; i < 4; i++) {
      const buffer = new Uint8Array(4 * 1024 * 1024);
      buffer[0] = 0xff; buffer[1] = 0xd8; buffer[2] = 0xff;
      const file = new File([buffer], `photo_${i}.jpg`, { type: "image/jpeg" });
      formData.append("images", file);
    }

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("15 MB"));
  } finally {
    await close();
  }
});

test("Ingredients Image API: Rejects exceeding maximum file count (>5 images) with 400", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const formData = new FormData();
    // 6 valid files
    for (let i = 0; i < 6; i++) {
      const file = new File([validJpegBuffer], `photo_${i}.jpg`, { type: "image/jpeg" });
      formData.append("images", file);
    }

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("5 images"));
  } finally {
    await close();
  }
});

test("Ingredients Image API: One image uploaded successfully with mocked Gemini response", async () => {
  const { baseUrl, close } = await startTestServer();
  mockGeminiResponse(
    JSON.stringify({
      ingredients: ["tomatoes", "onions"],
      observations: "Ripe red tomatoes and fresh yellow onions",
      uncertainItems: [],
    })
  );

  try {
    const formData = new FormData();
    const file = new File([validJpegBuffer], "veg.jpg", { type: "image/jpeg" });
    formData.append("images", file);

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.deepEqual(data.ingredients, ["tomatoes", "onions"]);
    assert.strictEqual(data.observations, "Ripe red tomatoes and fresh yellow onions");
    assert.deepEqual(data.uncertainItems, []);
  } finally {
    restoreFetch();
    await close();
  }
});

test("Ingredients Image API: Multiple valid images analyzed and consolidated with duplicate deduplication", async () => {
  const { baseUrl, close } = await startTestServer();
  // Mock model returning duplicate ingredients across images
  mockGeminiResponse(
    JSON.stringify({
      ingredients: ["tomatoes", "garlic", "Tomatoes", "paneer", "garlic"],
      observations: "Combined items from vegetable basket and dairy packaging",
      uncertainItems: ["yellow lentils (moong or toor dal)"],
    })
  );

  try {
    const formData = new FormData();
    formData.append("images", new File([validJpegBuffer], "img1.jpg", { type: "image/jpeg" }));
    formData.append("images", new File([validPngBuffer], "img2.png", { type: "image/png" }));
    formData.append("images", new File([validWebpBuffer], "img3.webp", { type: "image/webp" }));

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    // Deduplicated case-insensitively
    assert.deepEqual(data.ingredients, ["tomatoes", "garlic", "paneer"]);
    assert.strictEqual(data.observations, "Combined items from vegetable basket and dairy packaging");
    // Ambiguous items preserved separately
    assert.deepEqual(data.uncertainItems, ["yellow lentils (moong or toor dal)"]);
  } finally {
    restoreFetch();
    await close();
  }
});

test("Ingredients Image API: Gracefully handles Gemini API failure with 500 error", async () => {
  const { baseUrl, close } = await startTestServer();
  mockGeminiResponse(null, 500);

  try {
    const formData = new FormData();
    formData.append("images", new File([validJpegBuffer], "photo.jpg", { type: "image/jpeg" }));

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("error") || data.message.includes("failed"));
  } finally {
    restoreFetch();
    await close();
  }
});

test("Ingredients Image API: Gracefully handles malformed model output with 500 error", async () => {
  const { baseUrl, close } = await startTestServer();
  mockGeminiResponse("THIS IS NOT VALID JSON");

  try {
    const formData = new FormData();
    formData.append("images", new File([validJpegBuffer], "photo.jpg", { type: "image/jpeg" }));

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  } finally {
    restoreFetch();
    await close();
  }
});

test("Ingredients Image API: Gracefully handles Gemini response missing 'ingredients' field", async () => {
  const { baseUrl, close } = await startTestServer();
  mockGeminiResponse(
    JSON.stringify({
      observations: "Some observations",
      uncertainItems: [],
    })
  );

  try {
    const formData = new FormData();
    formData.append("images", new File([validJpegBuffer], "photo.jpg", { type: "image/jpeg" }));

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("missing required 'ingredients' field"));
  } finally {
    restoreFetch();
    await close();
  }
});

test("Ingredients Image API: Gracefully handles Gemini response with invalid 'ingredients' type", async () => {
  const { baseUrl, close } = await startTestServer();
  mockGeminiResponse(
    JSON.stringify({
      ingredients: "not an array",
      observations: "Some observations",
      uncertainItems: [],
    })
  );

  try {
    const formData = new FormData();
    formData.append("images", new File([validJpegBuffer], "photo.jpg", { type: "image/jpeg" }));

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("'ingredients' must be an array"));
  } finally {
    restoreFetch();
    await close();
  }
});

test("Ingredients Image API: Gracefully handles Gemini response missing 'observations' or 'uncertainItems'", async () => {
  const { baseUrl, close } = await startTestServer();
  mockGeminiResponse(
    JSON.stringify({
      ingredients: ["tomatoes"],
    })
  );

  try {
    const formData = new FormData();
    formData.append("images", new File([validJpegBuffer], "photo.jpg", { type: "image/jpeg" }));

    const res = await fetch(`${baseUrl}/api/ingredients/image-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testToken}` },
      body: formData,
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("missing required 'observations' field"));
  } finally {
    restoreFetch();
    await close();
  }
});

test("Vision Validator: Validates structured output schema and type constraints", () => {
  // Valid payload passes without error
  assert.doesNotThrow(() => {
    validateVisionResponse({
      ingredients: ["paneer", "spinach"],
      observations: "Fresh ingredients",
      uncertainItems: ["lentils"],
    });
  });

  // Rejects non-objects, null, and arrays
  assert.throws(() => validateVisionResponse(null), /expected a JSON object/);
  assert.throws(() => validateVisionResponse("string"), /expected a JSON object/);
  assert.throws(() => validateVisionResponse([]), /expected a JSON object/);

  // Rejects missing fields
  assert.throws(() => validateVisionResponse({ observations: "x", uncertainItems: [] }), /missing required 'ingredients' field/);
  assert.throws(() => validateVisionResponse({ ingredients: [], uncertainItems: [] }), /missing required 'observations' field/);
  assert.throws(() => validateVisionResponse({ ingredients: [], observations: "x" }), /missing required 'uncertainItems' field/);

  // Rejects wrong types
  assert.throws(() => validateVisionResponse({ ingredients: "string", observations: "x", uncertainItems: [] }), /'ingredients' must be an array/);
  assert.throws(() => validateVisionResponse({ ingredients: [123], observations: "x", uncertainItems: [] }), /all items in 'ingredients' must be strings/);
  assert.throws(() => validateVisionResponse({ ingredients: [], observations: 123, uncertainItems: [] }), /'observations' must be a string/);
  assert.throws(() => validateVisionResponse({ ingredients: [], observations: "x", uncertainItems: "wrong" }), /'uncertainItems' must be an array/);
  assert.throws(() => validateVisionResponse({ ingredients: [], observations: "x", uncertainItems: [{}] }), /all items in 'uncertainItems' must be strings/);
});



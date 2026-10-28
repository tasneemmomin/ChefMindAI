import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Recipe from "../models/Recipe.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";
process.env.GEMINI_API_KEY = "mock-api-key-for-chat-tests";

const userAId = "507f1f77bcf86cd799439011";
const userBId = "507f1f77bcf86cd799439022";
const tokenA = jwt.sign({ userId: userAId }, process.env.JWT_SECRET);
const tokenB = jwt.sign({ userId: userBId }, process.env.JWT_SECRET);

const originalFetch = globalThis.fetch;

function mockGeminiResponse(candidateText, status = 200) {
  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      if (status >= 400) {
        return {
          ok: false,
          status,
          json: async () => ({ error: { message: "Simulated Gemini chat API failure" } }),
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

const sampleRecipe = {
  title: "Classic Paneer Tikka Masala",
  description: "A rich and fragrant curry with charred paneer cubes in tomato gravy.",
  servings: 4,
  prepTimeMinutes: 15,
  cookTimeMinutes: 25,
  difficulty: "Medium",
  cuisine: "Indian",
  dietaryPreferences: ["Vegetarian"],
  ingredients: [
    { name: "paneer", quantity: 250, unit: "g", optional: false },
    { name: "tomatoes", quantity: 3, unit: "medium", optional: false },
    { name: "onion", quantity: 1, unit: "large", optional: false },
    { name: "garam masala", quantity: 1, unit: "tsp", optional: false },
    { name: "chili powder", quantity: 1, unit: "tsp", optional: false },
    { name: "cream", quantity: 2, unit: "tbsp", optional: false },
  ],
  instructions: [
    { step: 1, instruction: "Marinate paneer and saute until golden brown.", tip: "Do not overcook paneer." },
    { step: 2, instruction: "Saute onions, tomatoes, and spices until oil separates.", tip: "Cook on low heat." },
    { step: 3, instruction: "Add simmered sauce to paneer and finish with fresh cream.", tip: "Garnish with cilantro." },
  ],
  substitutions: [
    { original: "paneer", replacement: "extra firm tofu", ratio: "1:1", notes: "Great vegan substitute" }
  ],
  nutritionEstimates: {
    calories: 380,
    protein: 16,
    carbs: 14,
    fat: 28,
  },
  tips: ["Serve with warm garlic naan or basmati rice."],
};

test("Recipe Chat API: Rejects unauthenticated requests with 401 Unauthorized", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const resChat = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "Can I use tofu instead of paneer?",
      }),
    });
    assert.strictEqual(resChat.status, 401);

    const resSave = await fetch(`${baseUrl}/api/recipes/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe: sampleRecipe,
      }),
    });
    assert.strictEqual(resSave.status, 401);
  } finally {
    await close();
  }
});

test("Recipe Chat API: Validates message and history bounds (rejects empty/oversized messages and history)", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    // Empty message
    const resEmpty = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "   ",
      }),
    });
    assert.strictEqual(resEmpty.status, 400);
    const dataEmpty = await resEmpty.json();
    assert.strictEqual(dataEmpty.success, false);

    // Oversized message (> 500 chars)
    const longMessage = "a".repeat(501);
    const resLong = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: longMessage,
      }),
    });
    assert.strictEqual(resLong.status, 400);

    // Oversized history (> 10 items)
    const excessiveHistory = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));
    const resHistory = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "How long does this take?",
        history: excessiveHistory,
      }),
    });
    assert.strictEqual(resHistory.status, 400);

    // Missing recipe context
    const resNoRecipe = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        message: "How long does this take?",
      }),
    });
    assert.strictEqual(resNoRecipe.status, 400);
  } finally {
    await close();
  }
});

test("Recipe Chat API: Informational recipe question returns type 'answer' without mutating recipe", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    mockGeminiResponse(
      JSON.stringify({
        type: "answer",
        message: "Tomatoes provide acidity and body to the gravy. If you don't have fresh tomatoes, you can use 2 tablespoons of tomato paste diluted with warm water, or canned crushed tomatoes.",
      })
    );

    const res = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "I don't have tomatoes. What can I use instead?",
        history: [],
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.response.type, "answer");
    assert.match(data.response.message, /Tomatoes provide acidity/);
    assert.strictEqual(data.response.updatedRecipe, undefined);
  } finally {
    restoreFetch();
    await close();
  }
});

test("Recipe Chat API: Recipe modification request returns structured 'recipe_update' with validated recipe and changes", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const updatedSample = {
      ...sampleRecipe,
      title: "Mild Paneer Tikka Masala",
      ingredients: sampleRecipe.ingredients.map((ing) =>
        ing.name === "chili powder" ? { ...ing, quantity: 0.25, unit: "tsp" } : ing
      ),
      tips: [...sampleRecipe.tips, "Chili powder was reduced to 1/4 tsp for a milder flavor."],
    };

    mockGeminiResponse(
      JSON.stringify({
        type: "recipe_update",
        message: "I reduced the chili powder to 1/4 tsp so the dish has a very mild, pleasant warmth.",
        changes: [
          {
            field: "ingredients",
            description: "Reduced chili powder from 1 tsp to 1/4 tsp for mild heat level",
          },
        ],
        updatedRecipe: updatedSample,
      })
    );

    const res = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "Make this recipe much less spicy please.",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.response.type, "recipe_update");
    assert.match(data.response.message, /reduced the chili powder/);
    assert.strictEqual(Array.isArray(data.response.changes), true);
    assert.strictEqual(data.response.changes.length, 1);
    assert.strictEqual(data.response.changes[0].field, "ingredients");
    assert.strictEqual(typeof data.response.updatedRecipe, "object");
    assert.strictEqual(data.response.updatedRecipe.title, "Mild Paneer Tikka Masala");
    // Verify sanitized structure conforms to schema
    assert.strictEqual(Array.isArray(data.response.updatedRecipe.ingredients), true);
    assert.strictEqual(Array.isArray(data.response.updatedRecipe.instructions), true);
  } finally {
    restoreFetch();
    await close();
  }
});

test("Recipe Chat API: Ambiguous question returns type 'clarification' asking a friendly question", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    mockGeminiResponse(
      JSON.stringify({
        type: "clarification",
        message: "Would you like me to adjust the ingredients for dietary needs (like dairy-free or gluten-free), change the spice level, or scale the servings?",
      })
    );

    const res = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "Can you change something in this recipe?",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.response.type, "clarification");
    assert.match(data.response.message, /Would you like me to adjust/);
  } finally {
    restoreFetch();
    await close();
  }
});

test("Recipe Chat API: Gracefully handles markdown-fenced or raw text responses from Gemini", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    // Markdown-fenced code block response
    mockGeminiResponse(
      "```json\n" +
      JSON.stringify({
        type: "answer",
        message: "You can bloom the cumin seeds in warm ghee for 30 seconds until aromatic.",
      }) +
      "\n```"
    );

    const resFenced = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "How should I bloom spices?",
      }),
    });

    assert.strictEqual(resFenced.status, 200);
    const dataFenced = await resFenced.json();
    assert.strictEqual(dataFenced.response.type, "answer");
    assert.match(dataFenced.response.message, /bloom the cumin seeds/);

    // Non-JSON plain text fallback
    mockGeminiResponse("To make it dairy-free, substitute coconut milk for the fresh cream.");

    const resPlain = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "How do I make it dairy-free?",
      }),
    });

    assert.strictEqual(resPlain.status, 200);
    const dataPlain = await resPlain.json();
    assert.strictEqual(dataPlain.response.type, "answer");
    assert.match(dataPlain.response.message, /substitute coconut milk/);
  } finally {
    restoreFetch();
    await close();
  }
});

test("Recipe Chat API: Enforces recipe ownership isolation (User B cannot chat with User A's recipe)", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFindOne = Recipe.findOne;
  const savedUserARecipeId = "507f1f77bcf86cd799439033";
  const mockRecipeStore = new Map();

  const userARecipeDoc = {
    ...sampleRecipe,
    _id: savedUserARecipeId,
    owner: userAId,
  };
  mockRecipeStore.set(savedUserARecipeId, userARecipeDoc);

  Recipe.findOne = (query) => ({
    lean: async () => {
      const idStr = query._id?.toString();
      const found = mockRecipeStore.get(idStr);
      if (found && found.owner === query.owner) {
        return found;
      }
      return null;
    },
  });

  try {
    // User A can access it via :id/chat
    mockGeminiResponse(
      JSON.stringify({
        type: "answer",
        message: "This step is easy!",
      })
    );

    const resOwner = await fetch(`${baseUrl}/api/recipes/${savedUserARecipeId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        message: "Can you explain step 1?",
      }),
    });
    assert.strictEqual(resOwner.status, 200);

    // User B attempting to chat with User A's recipe ID receives 404 Not Found
    const resForbidden = await fetch(`${baseUrl}/api/recipes/${savedUserARecipeId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        message: "Can you explain step 1?",
      }),
    });
    assert.strictEqual(resForbidden.status, 404);
    const dataForbidden = await resForbidden.json();
    assert.strictEqual(dataForbidden.success, false);
    assert.match(dataForbidden.message, /permission/);

    // User B attempting to pass User A's _id in the body to /chat also receives 404
    const resBodyCheck = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        recipe: { ...sampleRecipe, _id: savedUserARecipeId },
        message: "Can you explain step 1?",
      }),
    });
    assert.strictEqual(resBodyCheck.status, 404);
  } finally {
    Recipe.findOne = originalFindOne;
    restoreFetch();
    await close();
  }
});

test("Recipe Chat API: Returns 500 when Gemini API fails gracefully", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    mockGeminiResponse("", 500);

    const res = await fetch(`${baseUrl}/api/recipes/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: sampleRecipe,
        message: "Can you help me tweak this recipe?",
      }),
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(typeof data.message, "string");
  } finally {
    restoreFetch();
    await close();
  }
});

test("Custom Recipe Saving: POST /api/recipes/save saves customized recipe as new document and leaves original untouched", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalCreate = Recipe.create;
  const originalFindById = Recipe.findById;

  const customStore = new Map();
  const originalRecipeId = "507f1f77bcf86cd799439044";
  const originalDoc = {
    ...sampleRecipe,
    _id: originalRecipeId,
    title: "Original Paneer Curry",
    owner: userAId,
  };
  customStore.set(originalRecipeId, originalDoc);

  Recipe.create = async (doc) => {
    const newId = "507f1f77bcf86cd799439055";
    const saved = { ...doc, _id: newId };
    customStore.set(newId, saved);
    return saved;
  };

  Recipe.findById = async (id) => customStore.get(id?.toString()) || null;

  try {
    const modifiedRecipeData = {
      ...sampleRecipe,
      title: "Modified Tofu Tikka Curry",
      ingredients: [
        { name: "extra firm tofu", quantity: 250, unit: "g" },
        { name: "tomatoes", quantity: 3, unit: "medium" },
      ],
      dietaryPreferences: ["Vegan"],
    };

    // User A saves modified recipe as a new recipe
    const resSave = await fetch(`${baseUrl}/api/recipes/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        recipe: modifiedRecipeData,
      }),
    });

    assert.strictEqual(resSave.status, 201);
    const saveData = await resSave.json();
    assert.strictEqual(saveData.success, true);
    assert.strictEqual(saveData.recipe.title, "Modified Tofu Tikka Curry");
    assert.strictEqual(saveData.recipe.owner.toString(), userAId);
    assert.notStrictEqual(saveData.recipe._id.toString(), originalRecipeId);

    // Verify original recipe in DB was NOT modified or overwritten
    const checkOriginal = await Recipe.findById(originalRecipeId);
    assert.strictEqual(checkOriginal.title, "Original Paneer Curry");
    assert.strictEqual(checkOriginal.ingredients.length, sampleRecipe.ingredients.length);
  } finally {
    Recipe.create = originalCreate;
    Recipe.findById = originalFindById;
    await close();
  }
});

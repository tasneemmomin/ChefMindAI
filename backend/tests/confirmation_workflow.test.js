import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Recipe from "../models/Recipe.js";
import { validateAndNormalizeIngredients } from "../controllers/recipeController.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";
const testUserId = "507f1f77bcf86cd799439011";
const testToken = jwt.sign({ userId: testUserId }, process.env.JWT_SECRET);

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

test("Workflow: End-to-end review, edit, add, remove, and uncertain item resolution flow", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFetch = globalThis.fetch;
  const originalCreate = Recipe.create;

  let capturedPrompt = "";
  let capturedRecipeDoc = null;

  process.env.GEMINI_API_KEY = "mock-api-key-workflow-test";

  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      const parsed = JSON.parse(options.body);
      capturedPrompt = parsed.contents[0].parts[0].text;
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
                      title: "Garam Masala Paneer Delight",
                      description: "A customized dish created from confirmed ingredients.",
                      prepTime: "15 mins",
                      cookTime: "20 mins",
                      servings: 3,
                      ingredients: ["2 red onions", "salt", "200 g paneer", "1 tsp garam masala"],
                      instructions: ["Saute onions", "Add paneer and spices", "Serve hot"],
                      tips: ["Garnish with fresh coriander if desired"],
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

  Recipe.create = async (doc) => {
    capturedRecipeDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439088",
      owner: testUserId,
      ...doc,
    };
  };

  try {
    // 1. Initial simulated AI vision detection output
    const rawAiDetection = {
      ingredients: ["onion", "potato", "salt"],
      uncertainItems: ["jeera seeds", "curry powder"],
    };

    // 2. User simulates client-side edits:
    // a. Edit ingredient: "onion" -> "2 red onions"
    let currentList = rawAiDetection.ingredients.map((item) =>
      item === "onion" ? "2 red onions" : item
    );

    // b. Remove ingredient: remove "potato"
    currentList = currentList.filter((item) => item !== "potato");

    // c. Add missing ingredient: "200 g paneer"
    currentList.push("200 g paneer");

    // d. Handle uncertain suggestions:
    // Dismiss "jeera seeds"
    const uncertainList = rawAiDetection.uncertainItems.filter((item) => item !== "jeera seeds");
    assert.strictEqual(uncertainList.length, 1);
    assert.strictEqual(uncertainList[0], "curry powder");

    // Edit uncertain item "curry powder" -> "1 tsp garam masala" and add to confirmed list
    const promotedItem = "1 tsp garam masala";
    currentList.push(promotedItem);

    // 3. Confirming the final ingredient list
    assert.deepStrictEqual(currentList, ["2 red onions", "salt", "200 g paneer", "1 tsp garam masala"]);

    // Ensure neither "potato" (removed) nor "jeera seeds" (dismissed) are in currentList
    assert.ok(!currentList.includes("potato"));
    assert.ok(!currentList.includes("jeera seeds"));
    assert.ok(!currentList.includes("onion")); // Original unedited item replaced

    // 4. Send final confirmed ingredients to recipe generation
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({
        ingredients: currentList,
        meal: "Lunch",
        cuisine: "North Indian",
        diet: "Vegetarian",
        cookingTime: "20",
        servings: "3",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.recipe.title, "Garam Masala Paneer Delight");

    // 5. Verify that strictly the edited ingredients reached Gemini, not the raw AI detection
    assert.ok(capturedPrompt.includes("Available ingredients: 2 red onions, salt, 200 g paneer, 1 tsp garam masala"));
    assert.ok(!capturedPrompt.includes("Available ingredients: onion, potato, salt"));
    assert.ok(!capturedPrompt.includes("jeera seeds"));

    // 6. Verify preferences preserved
    assert.strictEqual(capturedRecipeDoc.meal, "Lunch");
    assert.strictEqual(capturedRecipeDoc.cuisine, "North Indian");
    assert.strictEqual(capturedRecipeDoc.diet, "Vegetarian");
    assert.strictEqual(capturedRecipeDoc.servings, 3);
  } finally {
    globalThis.fetch = originalFetch;
    Recipe.create = originalCreate;
    await close();
  }
});

test("Workflow: Preserves text and voice inputs into review and normalization", () => {
  // Text input normalization
  const textInput = "  2 tomatoes, 1 cup rice,   olive oil  ";
  const parsedFromText = validateAndNormalizeIngredients(textInput);
  assert.deepStrictEqual(parsedFromText.cleanItems, ["2 tomatoes", "1 cup rice", "olive oil"]);

  // Voice input normalization
  const voiceInput = "200 g paneer, 1 chopped capsicum, 1/2 tsp turmeric";
  const parsedFromVoice = validateAndNormalizeIngredients(voiceInput);
  assert.deepStrictEqual(parsedFromVoice.cleanItems, [
    "200 g paneer",
    "1 chopped capsicum",
    "1/2 tsp turmeric",
  ]);

  // Preserves quantities accurately
  assert.strictEqual(parsedFromVoice.cleanItems[0], "200 g paneer");
  assert.strictEqual(parsedFromVoice.cleanItems[2], "1/2 tsp turmeric");
});

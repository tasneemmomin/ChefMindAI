import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Recipe from "../models/Recipe.js";
import {
  validateAndNormalizeIngredients,
  validateAndSanitizeCookingPreferences,
  normalizeRecipeLanguage,
  ALLOWED_SPICE_LEVELS,
  ALLOWED_LANGUAGES,
  MAX_INSTRUCTIONS_LENGTH,
  parseIngredientString,
} from "../controllers/recipeController.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";

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

const userAId = "507f1f77bcf86cd799439011";
const userBId = "507f1f77bcf86cd799439022";
const tokenA = jwt.sign({ userId: userAId }, process.env.JWT_SECRET);
const tokenB = jwt.sign({ userId: userBId }, process.env.JWT_SECRET);

test("Recipes API: Rejects unauthenticated requests with 401 Unauthorized", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const resGet = await fetch(`${baseUrl}/api/recipes`);
    assert.strictEqual(resGet.status, 401);

    const resPost = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients: "potato" }),
    });
    assert.strictEqual(resPost.status, 401);

    const resPatch = await fetch(`${baseUrl}/api/recipes/507f1f77bcf86cd799439099/favorite`, {
      method: "PATCH",
    });
    assert.strictEqual(resPatch.status, 401);

    const resDelete = await fetch(`${baseUrl}/api/recipes/507f1f77bcf86cd799439099`, {
      method: "DELETE",
    });
    assert.strictEqual(resDelete.status, 401);
  } finally {
    await close();
  }
});

test("Recipes API: Rejects invalid ObjectId format with 400 Bad Request", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const resFavorite = await fetch(`${baseUrl}/api/recipes/invalid-id-format/favorite`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(resFavorite.status, 400);
    const dataFav = await resFavorite.json();
    assert.strictEqual(dataFav.success, false);
    assert.ok(dataFav.message.includes("Invalid recipe ID format"));

    const resDelete = await fetch(`${baseUrl}/api/recipes/invalid-id-format`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(resDelete.status, 400);
    const dataDel = await resDelete.json();
    assert.strictEqual(dataDel.success, false);
    assert.ok(dataDel.message.includes("Invalid recipe ID format"));
  } finally {
    await close();
  }
});

test("Recipes API: Enforces user isolation (User B cannot access or modify User A's recipe)", async () => {
  const { baseUrl, close } = await startTestServer();
  const targetRecipeId = "507f1f77bcf86cd799439088";

  const originalFind = Recipe.find;
  const originalFindOne = Recipe.findOne;
  const originalFindOneAndDelete = Recipe.findOneAndDelete;

  // Stub Recipe.find to return only recipes owned by the querying user
  Recipe.find = (query) => ({
    sort: () => ({
      lean: async () => {
        if (query.owner === userAId) {
          return [{ _id: targetRecipeId, title: "User A Pasta", owner: userAId }];
        }
        return [];
      },
    }),
  });

  // Stub Recipe.findOne to only match if owner matches query.owner
  Recipe.findOne = async (query) => {
    if (query._id === targetRecipeId && query.owner === userAId) {
      return {
        _id: targetRecipeId,
        owner: userAId,
        isFavorite: false,
        save: async () => {},
      };
    }
    return null;
  };

  // Stub Recipe.findOneAndDelete to only delete if owner matches
  Recipe.findOneAndDelete = async (query) => {
    if (query._id === targetRecipeId && query.owner === userAId) {
      return { _id: targetRecipeId, owner: userAId };
    }
    return null;
  };

  try {
    // User B tries to list recipes -> User A's recipe should NOT appear
    const resBList = await fetch(`${baseUrl}/api/recipes`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const dataBList = await resBList.json();
    assert.strictEqual(dataBList.recipes.length, 0);

    // User B tries to favorite User A's recipe -> 404 Recipe not found
    const resBFav = await fetch(`${baseUrl}/api/recipes/${targetRecipeId}/favorite`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.strictEqual(resBFav.status, 404);
    const dataBFav = await resBFav.json();
    assert.strictEqual(dataBFav.message, "Recipe not found.");

    // User B tries to delete User A's recipe -> 404 Recipe not found
    const resBDel = await fetch(`${baseUrl}/api/recipes/${targetRecipeId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.strictEqual(resBDel.status, 404);
    const dataBDel = await resBDel.json();
    assert.strictEqual(dataBDel.message, "Recipe not found.");

    // User A can successfully favorite their own recipe
    const resAFav = await fetch(`${baseUrl}/api/recipes/${targetRecipeId}/favorite`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(resAFav.status, 200);

    // User A can successfully delete their own recipe
    const resADel = await fetch(`${baseUrl}/api/recipes/${targetRecipeId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(resADel.status, 200);
  } finally {
    Recipe.find = originalFind;
    Recipe.findOne = originalFindOne;
    Recipe.findOneAndDelete = originalFindOneAndDelete;
    await close();
  }
});

test("Ingredients Validation: Normalizes ingredients and preserves quantities", () => {
  // Test array input with quantities
  const arrayResult = validateAndNormalizeIngredients([" 2 onions ", "200 g paneer", "  1 tsp salt  "]);
  assert.deepStrictEqual(arrayResult.cleanItems, ["2 onions", "200 g paneer", "1 tsp salt"]);
  assert.strictEqual(arrayResult.combinedString, "2 onions, 200 g paneer, 1 tsp salt");

  // Test comma-separated string input
  const stringResult = validateAndNormalizeIngredients("2 onions, 200 g paneer, 1 tsp salt");
  assert.deepStrictEqual(stringResult.cleanItems, ["2 onions", "200 g paneer", "1 tsp salt"]);
  assert.strictEqual(stringResult.combinedString, "2 onions, 200 g paneer, 1 tsp salt");

  // Allows same base ingredient with different quantities
  const diffQtyResult = validateAndNormalizeIngredients(["1 chopped onion", "2 sliced onions"]);
  assert.strictEqual(diffQtyResult.cleanItems.length, 2);
  assert.deepStrictEqual(diffQtyResult.cleanItems, ["1 chopped onion", "2 sliced onions"]);
});

test("Ingredients Validation: Rejects invalid, empty, or oversized ingredient payloads", () => {
  // Null or undefined
  assert.throws(() => validateAndNormalizeIngredients(null), /Please provide your ingredients/);
  assert.throws(() => validateAndNormalizeIngredients(undefined), /Please provide your ingredients/);

  // Empty string or whitespace
  assert.throws(() => validateAndNormalizeIngredients(""), /Please provide at least one valid ingredient/);
  assert.throws(() => validateAndNormalizeIngredients("    "), /Please provide at least one valid ingredient/);

  // Empty array or array with only whitespaces
  assert.throws(() => validateAndNormalizeIngredients([]), /Please provide at least one valid ingredient/);
  assert.throws(() => validateAndNormalizeIngredients(["   ", ""]), /Please provide at least one valid ingredient/);

  // Non-string, non-array types
  assert.throws(() => validateAndNormalizeIngredients(12345), /Invalid ingredients payload/);
  assert.throws(() => validateAndNormalizeIngredients({ item: "onion" }), /Invalid ingredients payload/);
  assert.throws(() => validateAndNormalizeIngredients(true), /Invalid ingredients payload/);

  // Array containing non-string items
  assert.throws(() => validateAndNormalizeIngredients(["onion", 123]), /All ingredients in the list must be text strings/);

  // Exceeding 150 characters for a single ingredient
  const longItem = "a".repeat(151);
  assert.throws(() => validateAndNormalizeIngredients([longItem]), /exceeds the maximum length of 150 characters/);

  // Exceeding 50 items
  const fiftyOneItems = Array.from({ length: 51 }, (_, i) => `ingredient-${i}`);
  assert.throws(() => validateAndNormalizeIngredients(fiftyOneItems), /Maximum allowed is 50 ingredients/);

  // Exceeding combined 2000 characters
  const longItems = Array.from({ length: 25 }, () => "a".repeat(100));
  assert.throws(() => validateAndNormalizeIngredients(longItems), /Maximum allowed is 2000 characters/);
});

test("Recipes API: Rejects empty or malformed ingredients payload with 400 Bad Request", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    // Empty string
    const resEmptyStr = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ ingredients: "   " }),
    });
    assert.strictEqual(resEmptyStr.status, 400);
    const dataEmptyStr = await resEmptyStr.json();
    assert.strictEqual(dataEmptyStr.success, false);
    assert.ok(dataEmptyStr.message.includes("at least one valid ingredient"));

    // Empty array
    const resEmptyArr = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ ingredients: [] }),
    });
    assert.strictEqual(resEmptyArr.status, 400);
    const dataEmptyArr = await resEmptyArr.json();
    assert.strictEqual(dataEmptyArr.success, false);

    // Malformed type
    const resBadType = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ ingredients: { name: "potato" } }),
    });
    assert.strictEqual(resBadType.status, 400);
    const dataBadType = await resBadType.json();
    assert.strictEqual(dataBadType.success, false);

    // Overly long item
    const resTooLong = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ ingredients: ["x".repeat(151)] }),
    });
    assert.strictEqual(resTooLong.status, 400);
    const dataTooLong = await resTooLong.json();
    assert.strictEqual(dataTooLong.success, false);
  } finally {
    await close();
  }
});

test("Recipes API: Generates recipe using confirmed ingredients and preserves preferences", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFetch = globalThis.fetch;
  const originalCreate = Recipe.create;

  let capturedPrompt = "";
  let capturedCreateDoc = null;

  process.env.GEMINI_API_KEY = "mock-api-key-recipes-test";

  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      const parsedBody = JSON.parse(options.body);
      capturedPrompt = parsedBody.contents[0].parts[0].text;
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
                      title: "Paneer Onion Stir Fry",
                      description: "A quick and delicious dinner recipe.",
                      prepTime: "10 mins",
                      cookTime: "25 mins",
                      servings: 4,
                      ingredients: ["200 g paneer", "2 onions", "1 tsp salt"],
                      instructions: ["Chop onions.", "Saute paneer and onions.", "Serve warm."],
                      tips: ["Do not overcook paneer."],
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
    capturedCreateDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439077",
      owner: userAId,
      isFavorite: false,
      createdAt: new Date(),
      ...doc,
    };
  };

  try {
    // Send final confirmed ingredients list as an array with custom preferences
    const confirmedList = ["2 onions", "200 g paneer", "1 tsp salt"];
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        ingredients: confirmedList,
        meal: "Dinner",
        cuisine: "Indian",
        diet: "Vegetarian",
        cookingTime: "25",
        servings: "4",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.recipe.title, "Paneer Onion Stir Fry");

    // Verify confirmed ingredients reached Gemini prompt rather than unconfirmed items
    assert.ok(capturedPrompt.includes("Available ingredients: 2 onions, 200 g paneer, 1 tsp salt"));
    assert.ok(capturedPrompt.includes("Meal: Dinner"));
    assert.ok(capturedPrompt.includes("Cuisine: Indian"));
    assert.ok(capturedPrompt.includes("Dietary preference: Vegetarian"));
    assert.ok(capturedPrompt.includes("Maximum cooking time: 25 minutes"));
    assert.ok(capturedPrompt.includes("Servings: 4"));

    // Verify database document was saved with user preferences
    assert.strictEqual(capturedCreateDoc.meal, "Dinner");
    assert.strictEqual(capturedCreateDoc.cuisine, "Indian");
    assert.strictEqual(capturedCreateDoc.diet, "Vegetarian");
    assert.strictEqual(capturedCreateDoc.servings, 4);
    assert.strictEqual(capturedCreateDoc.owner, userAId);
  } finally {
    globalThis.fetch = originalFetch;
    Recipe.create = originalCreate;
    await close();
  }
});

test("Recipes API: Gracefully handles Gemini AI API error with 500 status", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFetch = globalThis.fetch;

  process.env.GEMINI_API_KEY = "mock-api-key-recipes-test";

  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal Gemini server error" } }),
      };
    }
    return originalFetch(url, options);
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        ingredients: ["tomato", "onion"],
      }),
    });

    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("Gemini") || data.message.includes("Failed"));
  } finally {
    globalThis.fetch = originalFetch;
    await close();
  }
});

test("validateAndSanitizeCookingPreferences: Validates spice levels, normalizes whitespace, and enforces 500-character maximum", () => {
  // Valid spice levels
  for (const level of ALLOWED_SPICE_LEVELS) {
    const res = validateAndSanitizeCookingPreferences({ spiceLevel: level.toLowerCase() });
    assert.strictEqual(res.cleanSpice, level);
  }

  // Fallback to "No preference" for invalid or missing spice level
  assert.strictEqual(validateAndSanitizeCookingPreferences({ spiceLevel: "nuclear" }).cleanSpice, "No preference");
  assert.strictEqual(validateAndSanitizeCookingPreferences({}).cleanSpice, "No preference");

  // Valid instructions normalization
  const normalized = validateAndSanitizeCookingPreferences({
    cookingInstructions: "   Make it   spicy and   rich   ",
  });
  assert.strictEqual(normalized.cleanInstructions, "Make it spicy and rich");

  // Empty or non-string instructions
  assert.strictEqual(validateAndSanitizeCookingPreferences({ cookingInstructions: "" }).cleanInstructions, "");
  assert.strictEqual(validateAndSanitizeCookingPreferences({ cookingInstructions: null }).cleanInstructions, "");
  assert.strictEqual(validateAndSanitizeCookingPreferences({}).cleanInstructions, "");

  // Strips unprintable control characters
  const withControlChars = validateAndSanitizeCookingPreferences({
    cookingInstructions: "Boil eggs\x00\x08 instead of omelette",
  });
  assert.strictEqual(withControlChars.cleanInstructions, "Boil eggs instead of omelette");

  // Exceeding 500 characters
  const tooLong = "a".repeat(MAX_INSTRUCTIONS_LENGTH + 1);
  assert.throws(
    () => validateAndSanitizeCookingPreferences({ cookingInstructions: tooLong }),
    /Cooking instructions cannot exceed 500 characters/
  );
});

test("Recipes API: Generates recipe with custom cooking instructions and spice level", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFetch = globalThis.fetch;
  const originalCreate = Recipe.create;

  let capturedPrompt = "";
  let capturedCreateDoc = null;

  process.env.GEMINI_API_KEY = "mock-api-key-recipes-test";

  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      const parsedBody = JSON.parse(options.body);
      capturedPrompt = parsedBody.contents[0].parts[0].text;
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
                      title: "North Indian Spicy Boiled Egg Curry",
                      description: "A rich, thick-gravy boiled egg curry made in authentic North Indian style.",
                      prepTime: "10 mins",
                      cookTime: "25 mins",
                      servings: 4,
                      ingredients: [
                        { name: "boiled eggs", quantity: 4, unit: "piece", optional: false },
                        { name: "onions", quantity: 2, unit: "piece", optional: false },
                        { name: "tomatoes", quantity: 2, unit: "piece", optional: false },
                        { name: "cream", quantity: 2, unit: "tbsp", optional: true },
                      ],
                      instructions: [
                        { step: 1, title: "Prepare Gravy", description: "Sauté onions and spices to a rich thick paste." },
                        { step: 2, title: "Add Eggs", description: "Add halved boiled eggs and simmer for 5 minutes." },
                      ],
                      tips: ["Do not over-boil eggs to maintain tender texture."],
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
    capturedCreateDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439099",
      owner: userAId,
      isFavorite: false,
      createdAt: new Date(),
      ...doc,
    };
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        ingredients: ["4 eggs", "2 onions", "2 tomatoes"],
        meal: "Dinner",
        cuisine: "North Indian",
        diet: "No preference",
        cookingTime: "30",
        servings: "4",
        spiceLevel: "Extra spicy",
        cookingInstructions: "use boiled eggs instead of an omelette, prepare it in North Indian style, make a thick gravy",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.recipe.title, "North Indian Spicy Boiled Egg Curry");

    // Verify custom instructions and spice level reached the Gemini prompt
    assert.ok(capturedPrompt.includes("Spice level: Extra spicy"));
    assert.ok(capturedPrompt.includes("Cuisine: North Indian"));
    assert.ok(capturedPrompt.includes("User's Custom Cooking Instructions & Preferences:"));
    assert.ok(capturedPrompt.includes("use boiled eggs instead of an omelette, prepare it in North Indian style, make a thick gravy"));
    assert.ok(capturedPrompt.includes("DISTINGUISH between preparation changes and ingredient requests"));
    assert.ok(capturedPrompt.includes("TRANSPARENT INGREDIENT HANDLING"));
    assert.ok(capturedPrompt.includes("DIETARY RESTRICTION SAFETY"));

    // Verify database document was saved with the custom cooking preferences
    assert.strictEqual(capturedCreateDoc.spiceLevel, "Extra spicy");
    assert.strictEqual(capturedCreateDoc.cookingInstructions, "use boiled eggs instead of an omelette, prepare it in North Indian style, make a thick gravy");
    assert.strictEqual(capturedCreateDoc.cuisine, "North Indian");
    assert.strictEqual(capturedCreateDoc.servings, 4);
  } finally {
    globalThis.fetch = originalFetch;
    Recipe.create = originalCreate;
    await close();
  }
});

test("Recipes API: Rejects overly long cooking instructions exceeding 500 characters with 400 Bad Request", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        ingredients: ["eggs", "onions"],
        cookingInstructions: "x".repeat(501),
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("Cooking instructions cannot exceed 500 characters"));
  } finally {
    await close();
  }
});

test("Recipes API: Successfully generates recipe when cooking instructions are omitted or empty", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFetch = globalThis.fetch;
  const originalCreate = Recipe.create;

  let capturedPrompt = "";
  let capturedCreateDoc = null;

  process.env.GEMINI_API_KEY = "mock-api-key-recipes-test";

  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      const parsedBody = JSON.parse(options.body);
      capturedPrompt = parsedBody.contents[0].parts[0].text;
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
                      title: "Classic Tomato Omelette",
                      description: "Simple and flavorful breakfast.",
                      prepTime: "5 mins",
                      cookTime: "10 mins",
                      servings: 2,
                      ingredients: ["2 eggs", "1 tomato", "salt"],
                      instructions: ["Beat eggs.", "Cook in skillet with tomatoes."],
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
    capturedCreateDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439098",
      owner: userAId,
      ...doc,
    };
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        ingredients: ["2 eggs", "1 tomato"],
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    // Verify default spice level is "No preference" and no custom instructions block in prompt
    assert.ok(capturedPrompt.includes("Spice level: No preference"));
    assert.ok(!capturedPrompt.includes("User's Custom Cooking Instructions & Preferences:"));
    assert.strictEqual(capturedCreateDoc.spiceLevel, "No preference");
    assert.strictEqual(capturedCreateDoc.cookingInstructions, "");
  } finally {
    globalThis.fetch = originalFetch;
    Recipe.create = originalCreate;
    await close();
  }
});

test("Recipes API: Save custom recipe endpoint preserves spiceLevel and cookingInstructions", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalCreate = Recipe.create;
  let capturedDoc = null;

  Recipe.create = async (doc) => {
    capturedDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439097",
      owner: userAId,
      ...doc,
    };
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        recipe: {
          title: "Custom Paneer Tikka",
          description: "Marinated spiced paneer cubes.",
          servings: 2,
          cookTimeMinutes: 20,
          spiceLevel: "Spicy",
          cookingInstructions: "make it extra crispy with less oil",
          ingredients: [{ name: "paneer", quantity: 200, unit: "g" }],
          instructions: [{ step: 1, title: "Marinate", description: "Coat with spices." }],
        },
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(capturedDoc.spiceLevel, "Spicy");
    assert.strictEqual(capturedDoc.cookingInstructions, "make it extra crispy with less oil");

    // Test saving without spiceLevel/cookingInstructions defaults to 'No preference' and ''
    const resDefault = await fetch(`${baseUrl}/api/recipes/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        recipe: {
          title: "Simple Dal",
          ingredients: [{ name: "lentils", quantity: 1, unit: "cup" }],
          instructions: ["Boil lentils."],
        },
      }),
    });

    assert.strictEqual(resDefault.status, 201);
    assert.strictEqual(capturedDoc.spiceLevel, "No preference");
    assert.strictEqual(capturedDoc.cookingInstructions, "");
  } finally {
    Recipe.create = originalCreate;
    await close();
  }
});

test("normalizeRecipeLanguage: Normalizes languages and defaults safely to English", () => {
  assert.strictEqual(normalizeRecipeLanguage("English"), "English");
  assert.strictEqual(normalizeRecipeLanguage("english"), "English");
  assert.strictEqual(normalizeRecipeLanguage("en"), "English");
  assert.strictEqual(normalizeRecipeLanguage("Hindi"), "Hindi");
  assert.strictEqual(normalizeRecipeLanguage("hindi"), "Hindi");
  assert.strictEqual(normalizeRecipeLanguage("hi"), "Hindi");
  assert.strictEqual(normalizeRecipeLanguage(""), "English");
  assert.strictEqual(normalizeRecipeLanguage(null), "English");
  assert.strictEqual(normalizeRecipeLanguage(undefined), "English");
  assert.strictEqual(normalizeRecipeLanguage("Spanish"), "English");
});

test("parseIngredientString: Parses Hindi ingredients and Devanagari numerals", () => {
  // Devanagari numerals and Hindi units
  const parsed1 = parseIngredientString("२ चम्मच हल्दी");
  assert.strictEqual(parsed1.quantity, 2);
  assert.strictEqual(parsed1.unit, "चम्मच");
  assert.strictEqual(parsed1.name, "हल्दी");

  const parsed2 = parseIngredientString("200 ग्राम पनीर");
  assert.strictEqual(parsed2.quantity, 200);
  assert.strictEqual(parsed2.unit, "ग्राम");
  assert.strictEqual(parsed2.name, "पनीर");
});

test("Recipes API: Generates recipe in Hindi and passes language to Gemini prompt and database", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFetch = globalThis.fetch;
  const originalCreate = Recipe.create;

  let capturedPrompt = "";
  let capturedCreateDoc = null;

  process.env.GEMINI_API_KEY = "mock-api-key-recipes-test";

  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
      const parsedBody = JSON.parse(options.body);
      capturedPrompt = parsedBody.contents[0].parts[0].text;
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
                      title: "मलाईदार पनीर भुर्जी",
                      description: "एक स्वादिष्ट और ताजगी भरी पनीर रेसिपी।",
                      prepTime: "10 mins",
                      cookTime: "15 mins",
                      servings: 2,
                      ingredients: [
                        { name: "पनीर", quantity: 200, unit: "ग्राम", optional: false },
                        { name: "प्याज", quantity: 2, unit: "टुकड़ा", optional: false },
                      ],
                      instructions: [
                        { step: 1, title: "तड़का लगाएं", description: "कड़ाही में तेल गरम करके प्याज भूनें।" },
                      ],
                      tips: ["पनीर को ज्यादा देर न पकाएं ताकि वह मुलायम रहे।"],
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
    capturedCreateDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439096",
      owner: userAId,
      ...doc,
    };
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        ingredients: ["paneer", "onions"],
        language: "Hindi",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.recipe.title, "मलाईदार पनीर भुर्जी");

    // Verify Hindi instructions and language requirement in Gemini prompt
    assert.ok(capturedPrompt.includes("Recipe language: Hindi"));
    assert.ok(capturedPrompt.includes("LANGUAGE & SCRIPT INSTRUCTION (HINDI / हिन्दी)"));
    assert.ok(capturedPrompt.includes("Devanagari script"));

    // Verify database document was saved with language: "Hindi"
    assert.strictEqual(capturedCreateDoc.language, "Hindi");
  } finally {
    globalThis.fetch = originalFetch;
    Recipe.create = originalCreate;
    await close();
  }
});

test("Recipes API: Save custom recipe endpoint preserves language and defaults to English", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalCreate = Recipe.create;
  let capturedDoc = null;

  Recipe.create = async (doc) => {
    capturedDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439095",
      owner: userAId,
      ...doc,
    };
  };

  try {
    // 1. Explicit Hindi language saved
    const resHindi = await fetch(`${baseUrl}/api/recipes/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        recipe: {
          title: "तड़का दाल",
          language: "Hindi",
          ingredients: [{ name: "दाल", quantity: 1, unit: "कप" }],
          instructions: [{ step: 1, title: "उबालें", description: "दाल को पानी में उबालें।" }],
        },
      }),
    });

    assert.strictEqual(resHindi.status, 201);
    assert.strictEqual(capturedDoc.language, "Hindi");

    // 2. Default English language when omitted
    const resEnglish = await fetch(`${baseUrl}/api/recipes/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        recipe: {
          title: "Yellow Dal",
          ingredients: [{ name: "lentils", quantity: 1, unit: "cup" }],
          instructions: ["Boil lentils."],
        },
      }),
    });

    assert.strictEqual(resEnglish.status, 201);
    assert.strictEqual(capturedDoc.language, "English");
  } finally {
    Recipe.create = originalCreate;
    await close();
  }
});



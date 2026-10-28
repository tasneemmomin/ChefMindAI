import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Recipe from "../models/Recipe.js";
import {
  parseIngredientString,
  parseInstructionItem,
  validateAndSanitizeRecipeData,
} from "../controllers/recipeController.js";
import {
  formatQuantity,
  isNonLinearIngredient,
  scaleIngredient,
} from "../../frontend/src/utils/recipeScaler.js";

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

test("parseIngredientString: Parses diverse ingredient formats and preserves quantities and units", () => {
  // Integer quantity with unit
  const item1 = parseIngredientString("200 g paneer");
  assert.deepStrictEqual(item1, {
    name: "paneer",
    quantity: 200,
    unit: "g",
    optional: false,
  });

  // Integer quantity without unit
  const item2 = parseIngredientString("2 onions");
  assert.deepStrictEqual(item2, {
    name: "onions",
    quantity: 2,
    unit: "",
    optional: false,
  });

  // Integer quantity with size descriptor as unit
  const item2b = parseIngredientString("2 medium onions");
  assert.deepStrictEqual(item2b, {
    name: "onions",
    quantity: 2,
    unit: "medium",
    optional: false,
  });

  // Fraction quantity with unit
  const item3 = parseIngredientString("1/2 tsp salt");
  assert.deepStrictEqual(item3, {
    name: "salt",
    quantity: 0.5,
    unit: "tsp",
    optional: false,
  });

  // Decimal quantity with unit
  const item4 = parseIngredientString("1.5 tbsp olive oil");
  assert.deepStrictEqual(item4, {
    name: "olive oil",
    quantity: 1.5,
    unit: "tbsp",
    optional: false,
  });

  // Ingredient without numeric quantity
  const item5 = parseIngredientString("Fresh coriander for garnish");
  assert.deepStrictEqual(item5, {
    name: "Fresh coriander for garnish",
    quantity: null,
    unit: "",
    optional: false,
  });

  // Empty or invalid input
  assert.strictEqual(parseIngredientString(""), null);
  assert.strictEqual(parseIngredientString(null), null);
});

test("parseInstructionItem: Normalizes strings and objects into sequential step structures", () => {
  // String instruction
  const step1 = parseInstructionItem("Chop all vegetables into bite-sized pieces.", 0);
  assert.deepStrictEqual(step1, {
    step: 1,
    title: "Step 1",
    description: "Chop all vegetables into bite-sized pieces.",
  });

  // Object instruction with title and step
  const step2 = parseInstructionItem(
    {
      step: 2,
      title: "Sauté the Aromatics",
      description: "Heat oil over medium-high heat and cook onions until golden brown (approx. 4 mins).",
    },
    1
  );
  assert.strictEqual(step2.step, 2);
  assert.strictEqual(step2.title, "Sauté the Aromatics");
  assert.ok(step2.description.includes("Heat oil"));

  // Malformed or null object fallback
  const stepFallback = parseInstructionItem(null, 2);
  assert.strictEqual(stepFallback.step, 3);
  assert.strictEqual(stepFallback.title, "Step 3");
});

test("validateAndSanitizeRecipeData: Validates full structured recipe output and sanitizes missing fields", () => {
  const mockAiOutput = {
    title: "Paneer & Vegetable Jalfrezi",
    description: "A zesty stir-fry loaded with crunchy bell peppers and tender paneer.",
    servings: 3,
    prepTimeMinutes: 12,
    cookTimeMinutes: 18,
    difficulty: "Medium",
    ingredients: [
      { name: "Paneer", quantity: 250, unit: "g", optional: false },
      { name: "Bell Pepper", quantity: 1, unit: "piece", optional: false },
      { name: "Fresh Cream", quantity: 2, unit: "tbsp", optional: true },
    ],
    instructions: [
      { step: 1, title: "Prep", description: "Cut paneer into cubes." },
      { step: 2, title: "Stir Fry", description: "Toss with spices in hot pan for 5 minutes." },
    ],
    substitutions: [
      {
        original: "Paneer",
        replacement: "Extra-firm Tofu",
        ratio: "1:1",
        notes: "Press before cooking to remove moisture; makes dish 100% vegan.",
      },
    ],
    dietaryNotes: ["Vegetarian", "Gluten-Free"],
    nutrition: {
      calories: 410,
      protein: "21g",
      carbs: "14g",
      fat: "31g",
      fiber: "3g",
    },
    tips: ["Pan-fry the paneer cubes first for enhanced texture."],
  };

  const result = validateAndSanitizeRecipeData(mockAiOutput, ["paneer", "pepper"], 20, 2);

  assert.strictEqual(result.title, "Paneer & Vegetable Jalfrezi");
  assert.strictEqual(result.difficulty, "Medium");
  assert.strictEqual(result.servings, 3);
  assert.strictEqual(result.prepTimeMinutes, 12);
  assert.strictEqual(result.cookTimeMinutes, 18);
  assert.strictEqual(result.prepTime, "12 mins");
  assert.strictEqual(result.cookTime, "18 mins");
  assert.strictEqual(result.ingredients.length, 3);
  assert.strictEqual(result.ingredients[2].optional, true);
  assert.strictEqual(result.instructions.length, 2);
  assert.strictEqual(result.substitutions.length, 1);
  assert.strictEqual(result.substitutions[0].replacement, "Extra-firm Tofu");
  assert.deepStrictEqual(result.dietaryNotes, ["Vegetarian", "Gluten-Free"]);
  assert.strictEqual(result.nutrition.calories, 410);
  assert.strictEqual(result.nutrition.protein, "21g");
  assert.strictEqual(result.tips.length, 1);
});

test("validateAndSanitizeRecipeData: Gracefully handles legacy string arrays and null nutrition", () => {
  const legacyAiOutput = {
    title: "Classic Potato Curry",
    description: "",
    ingredients: ["3 potatoes", "1 onion", "1 tsp turmeric"],
    instructions: ["Boil potatoes", "Cook with spices"],
    difficulty: "UnknownDifficulty", // Invalid difficulty -> should default to Easy
    nutrition: null, // No reliable estimates -> should remain null
  };

  const result = validateAndSanitizeRecipeData(legacyAiOutput, ["potatoes", "onion"], 25, 2);

  assert.strictEqual(result.title, "Classic Potato Curry");
  assert.strictEqual(result.difficulty, "Easy");
  assert.strictEqual(result.nutrition, null);

  // Assert legacy strings were converted to structured ingredient objects
  assert.strictEqual(result.ingredients.length, 3);
  assert.strictEqual(result.ingredients[0].name, "potatoes");
  assert.strictEqual(result.ingredients[0].quantity, 3);
  assert.strictEqual(result.ingredients[2].name, "turmeric");
  assert.strictEqual(result.ingredients[2].unit, "tsp");

  // Assert legacy instruction strings were converted to step objects
  assert.strictEqual(result.instructions.length, 2);
  assert.strictEqual(result.instructions[0].step, 1);
  assert.strictEqual(result.instructions[0].description, "Boil potatoes");
});

test("Serving Scaler Utility: Correctly formats quantities and handles fractional values", () => {
  assert.strictEqual(formatQuantity(1), "1");
  assert.strictEqual(formatQuantity(2), "2");
  assert.strictEqual(formatQuantity(0.5), "1/2");
  assert.strictEqual(formatQuantity(1.5), "1 1/2");
  assert.strictEqual(formatQuantity(0.25), "1/4");
  assert.strictEqual(formatQuantity(2.25), "2 1/4");
  assert.strictEqual(formatQuantity(0.75), "3/4");
  assert.strictEqual(formatQuantity(0.333), "1/3");
  assert.strictEqual(formatQuantity(0.667), "2/3");
  assert.strictEqual(formatQuantity(null), "");
  assert.strictEqual(formatQuantity(0), "0");
});

test("Serving Scaler Utility: Proportionally recalculates quantities with unit and optional flag preservation", () => {
  const baseItem = {
    name: "Paneer",
    quantity: 200,
    unit: "g",
    optional: false,
  };

  // Scale from 2 to 4 servings (ratio = 2)
  const scaledDouble = scaleIngredient(baseItem, 2);
  assert.strictEqual(scaledDouble.displayQuantity, "400");
  assert.strictEqual(scaledDouble.unit, "g");
  assert.strictEqual(scaledDouble.displayText, "400 g Paneer");
  assert.strictEqual(scaledDouble.optional, false);

  // Scale from 2 to 1 serving (ratio = 0.5)
  const scaledHalf = scaleIngredient(baseItem, 0.5);
  assert.strictEqual(scaledHalf.displayQuantity, "100");
  assert.strictEqual(scaledHalf.displayText, "100 g Paneer");

  // Optional item remains optional
  const optionalItem = {
    name: "Heavy Cream",
    quantity: 2,
    unit: "tbsp",
    optional: true,
  };
  const scaledOptional = scaleIngredient(optionalItem, 1.5);
  assert.strictEqual(scaledOptional.displayQuantity, "3");
  assert.strictEqual(scaledOptional.optional, true);
});

test("Serving Scaler Utility: Dampens salt and spice scaling when scaling up to protect dishes", () => {
  const saltItem = {
    name: "Salt",
    quantity: 1,
    unit: "tsp",
    optional: false,
  };

  assert.strictEqual(isNonLinearIngredient("Salt", "tsp"), true);
  assert.strictEqual(isNonLinearIngredient("Garam masala", "tsp"), true);
  assert.strictEqual(isNonLinearIngredient("Chicken breast", "g"), false);

  // Scaling salt up 4x: dampened formula prevents 4 full tsps of salt
  const scaledSalt = scaleIngredient(saltItem, 4);
  assert.strictEqual(scaledSalt.isSpiceCaution, true);
  const qtyNum = parseFloat(scaledSalt.displayQuantity);
  // With dampening factor 0.65, 1 * (1 + 3 * 0.65) = 2.95 (approx 3), strictly less than 4
  assert.ok(qtyNum < 4.0);
});

test("Serving Scaler Utility: Scales legacy string ingredients with fractions and units", () => {
  // Legacy string "200 g paneer" scaled x2
  const scaledStr = scaleIngredient("200 g paneer", 2);
  assert.strictEqual(scaledStr.displayQuantity, "400");
  assert.strictEqual(scaledStr.unit, "g");
  assert.strictEqual(scaledStr.name, "paneer");
  assert.strictEqual(scaledStr.displayText, "400 g paneer");

  // Legacy string "1/2 cup milk" scaled x2
  const scaledFraction = scaleIngredient("1/2 cup milk", 2);
  assert.strictEqual(scaledFraction.displayQuantity, "1");
  assert.strictEqual(scaledFraction.unit, "cup");
  assert.strictEqual(scaledFraction.displayText, "1 cup milk");

  // Legacy string without numeric quantity
  const scaledNoQty = scaleIngredient("Salt to taste", 2);
  assert.strictEqual(scaledNoQty.displayText, "Salt to taste");
});

test("Recipes API: Generates advanced structured recipe and persists all rich fields in MongoDB", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFetch = globalThis.fetch;
  const originalCreate = Recipe.create;

  let capturedPrompt = "";
  let capturedDoc = null;

  process.env.GEMINI_API_KEY = "mock-api-key-advanced-recipes";

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
                      title: "Creamy Paneer & Spinach Medley",
                      description: "A nourishing dish featuring pan-seared paneer cubes folded into wilted spinach.",
                      servings: 2,
                      prepTimeMinutes: 10,
                      cookTimeMinutes: 20,
                      difficulty: "Easy",
                      ingredients: [
                        { name: "Paneer", quantity: 200, unit: "g", optional: false },
                        { name: "Spinach", quantity: 150, unit: "g", optional: false },
                        { name: "Garlic cloves", quantity: 3, unit: "piece", optional: false },
                        { name: "Kasuri methi", quantity: 1, unit: "tsp", optional: true },
                      ],
                      instructions: [
                        { step: 1, title: "Blanch Spinach", description: "Blanch fresh spinach in boiling water for 2 mins." },
                        { step: 2, title: "Sauté Paneer", description: "Pan-fry paneer cubes until golden on medium heat." },
                        { step: 3, title: "Simmer & Combine", description: "Combine greens with paneer and simmer 5 minutes." },
                      ],
                      substitutions: [
                        {
                          original: "Paneer",
                          replacement: "Firm Tofu",
                          ratio: "1:1",
                          notes: "Great plant-based option; press moisture out first.",
                        },
                      ],
                      dietaryNotes: ["Vegetarian", "Keto-Friendly"],
                      nutrition: {
                        calories: 360,
                        protein: "19g",
                        carbs: "9g",
                        fat: "27g",
                        fiber: "4g",
                      },
                      tips: ["Do not over-boil the spinach to retain its bright green color."],
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
    capturedDoc = doc;
    return {
      _id: "507f1f77bcf86cd799439099",
      owner: testUserId,
      isFavorite: false,
      createdAt: new Date(),
      ...doc,
    };
  };

  try {
    const res = await fetch(`${baseUrl}/api/recipes/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({
        ingredients: ["200 g paneer", "150 g spinach", "garlic"],
        meal: "Dinner",
        cuisine: "Indian",
        diet: "Vegetarian",
        cookingTime: "20",
        servings: "2",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const recipe = data.recipe;
    assert.strictEqual(recipe.title, "Creamy Paneer & Spinach Medley");
    assert.strictEqual(recipe.difficulty, "Easy");
    assert.strictEqual(recipe.prepTimeMinutes, 10);
    assert.strictEqual(recipe.cookTimeMinutes, 20);
    assert.strictEqual(recipe.ingredients.length, 4);
    assert.strictEqual(recipe.ingredients[3].optional, true);
    assert.strictEqual(recipe.instructions.length, 3);
    assert.strictEqual(recipe.substitutions.length, 1);
    assert.deepStrictEqual(recipe.dietaryNotes, ["Vegetarian", "Keto-Friendly"]);
    assert.strictEqual(recipe.nutrition.calories, 360);

    // Verify document saved to database has rich fields
    assert.strictEqual(capturedDoc.difficulty, "Easy");
    assert.strictEqual(capturedDoc.prepTimeMinutes, 10);
    assert.strictEqual(capturedDoc.cookTimeMinutes, 20);
    assert.strictEqual(capturedDoc.substitutions.length, 1);
    assert.strictEqual(capturedDoc.nutrition.calories, 360);
  } finally {
    globalThis.fetch = originalFetch;
    Recipe.create = originalCreate;
    await close();
  }
});

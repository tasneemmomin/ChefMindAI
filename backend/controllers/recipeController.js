import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import { generateRecipeWithAI, chatAboutRecipeWithAI } from "../services/aiService.js";

/**
 * Sanitizes error messages to protect sensitive keys, paths, and internal details.
 */
function sanitizeErrorMessage(msg, fallback = "An unexpected error occurred.") {
  if (!msg || typeof msg !== "string") return fallback;
  if (
    msg.includes("GEMINI_API_KEY") ||
    msg.includes("GROQ_API_KEY") ||
    msg.toLowerCase().includes("api key")
  ) {
    return "AI service is not properly configured. Please contact support.";
  }
  let clean = msg.replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED]");
  clean = clean.replace(/gsk_[0-9A-Za-z_-]{40,60}/g, "[REDACTED]");
  clean = clean.replace(/\/[a-zA-Z0-9_\-./]+\.(js|json|env)/g, "[internal file]");
  return clean;
}

/**
 * Normalizes and validates the ingredients payload for recipe generation.
 * Accepts either a comma-separated string or an array of ingredient strings.
 */
export function validateAndNormalizeIngredients(ingredients) {
  if (ingredients === null || ingredients === undefined) {
    throw new Error("Please provide your ingredients.");
  }

  let items = [];
  if (Array.isArray(ingredients)) {
    items = ingredients;
  } else if (typeof ingredients === "string") {
    items = ingredients.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
  } else {
    throw new Error("Invalid ingredients payload. Expected a string or an array of strings.");
  }

  const cleanItems = [];
  for (const raw of items) {
    if (typeof raw !== "string") {
      throw new Error("All ingredients in the list must be text strings.");
    }
    const clean = raw.trim().replace(/\s+/g, " ");
    if (clean.length > 0) {
      if (clean.length > 150) {
        throw new Error(`Ingredient '${clean.slice(0, 30)}...' exceeds the maximum length of 150 characters.`);
      }
      cleanItems.push(clean);
    }
  }

  if (cleanItems.length === 0) {
    throw new Error("Please provide at least one valid ingredient.");
  }

  if (cleanItems.length > 50) {
    throw new Error("Too many ingredients. Maximum allowed is 50 ingredients.");
  }

  const combinedString = cleanItems.join(", ");
  if (combinedString.length > 2000) {
    throw new Error("Ingredients list is too long. Maximum allowed is 2000 characters.");
  }

  return { cleanItems, combinedString };
}

export const ALLOWED_SPICE_LEVELS = ["No preference", "Mild", "Medium", "Spicy", "Extra spicy"];
export const ALLOWED_LANGUAGES = ["English", "Hindi"];
export const MAX_INSTRUCTIONS_LENGTH = 500;

/**
 * Normalizes and validates the recipe language ("English" or "Hindi").
 */
export function normalizeRecipeLanguage(lang) {
  if (typeof lang === "string" && lang.trim()) {
    const lower = lang.trim().toLowerCase();
    if (lower === "hindi" || lower === "hi") return "Hindi";
    if (lower === "english" || lower === "en") return "English";
  }
  return "English";
}

/**
 * Validates and sanitizes pre-generation cooking instructions and spice level.
 */
export function validateAndSanitizeCookingPreferences({ spiceLevel, cookingInstructions } = {}) {
  let cleanSpice = "No preference";
  if (typeof spiceLevel === "string" && spiceLevel.trim()) {
    const match = ALLOWED_SPICE_LEVELS.find(
      (level) => level.toLowerCase() === spiceLevel.trim().toLowerCase()
    );
    cleanSpice = match || "No preference";
  }

  let cleanInstructions = "";
  if (typeof cookingInstructions === "string") {
    cleanInstructions = cookingInstructions.trim().replace(/\s+/g, " ");
    if (cleanInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
      throw new Error(`Cooking instructions cannot exceed ${MAX_INSTRUCTIONS_LENGTH} characters.`);
    }
    // Sanitize any dangerous unprintable control characters
    cleanInstructions = cleanInstructions.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }

  return { cleanSpice, cleanInstructions };
}

/**
 * Safely parse a raw ingredient string into a structured ingredient object.
 */
export function parseIngredientString(raw) {
  if (typeof raw !== "string") return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;

  // Convert Devanagari numerals to standard digits (०-९ -> 0-9)
  trimmed = trimmed.replace(/[\u0966-\u096F]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0966 + 48));

  // Handles numbers, decimals, and fractions at the beginning of the string with Unicode letters/marks for units
  const match = trimmed.match(/^([\d]+(?:[./][\d]+)?)\s*([\p{L}\p{M}]+)?\s+(.+)$/u);
  if (match) {
    const rawQty = match[1];
    let qty = parseFloat(rawQty);
    if (rawQty.includes("/")) {
      const parts = rawQty.split("/");
      if (parts.length === 2 && parseFloat(parts[1]) !== 0) {
        qty = parseFloat(parts[0]) / parseFloat(parts[1]);
      }
    }
    const unit = match[2] ? match[2].trim() : "";
    const name = match[3] ? match[3].trim() : "";
    return {
      name: name || trimmed,
      quantity: Number.isFinite(qty) ? Math.round(qty * 100) / 100 : null,
      unit,
      optional: false,
    };
  }

  return {
    name: trimmed,
    quantity: null,
    unit: "",
    optional: false,
  };
}

/**
 * Normalizes instruction item to { step, title, description } object.
 */
export function parseInstructionItem(raw, index = 0) {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return {
      step: index + 1,
      title: `Step ${index + 1}`,
      description: trimmed || "Prepare and cook according to recipe directions.",
    };
  }

  if (typeof raw === "object" && raw !== null) {
    const stepNum = typeof raw.step === "number" && raw.step > 0 ? raw.step : index + 1;
    const title = typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim().slice(0, 100)
      : `Step ${stepNum}`;
    const description = typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 1000)
      : typeof raw.text === "string" && raw.text.trim()
        ? raw.text.trim().slice(0, 1000)
        : "Follow cooking instructions carefully.";

    return {
      step: stepNum,
      title,
      description,
    };
  }

  return {
    step: index + 1,
    title: `Step ${index + 1}`,
    description: "Follow cooking instructions carefully.",
  };
}

/**
 * Validates, normalizes, and sanitizes the full recipe data structure returned by Gemini or fallbacks.
 */
export function validateAndSanitizeRecipeData(
  recipeData,
  fallbackCleanItems = [],
  cleanCookingTime = 20,
  cleanServings = 2
) {
  if (!recipeData || typeof recipeData !== "object") {
    recipeData = {};
  }

  // 1. Title
  const title = typeof recipeData.title === "string" && recipeData.title.trim()
    ? recipeData.title.trim().slice(0, 150)
    : "Delicious Chef Creation";

  // 2. Description
  const description = typeof recipeData.description === "string"
    ? recipeData.description.trim().slice(0, 600)
    : "";

  // 3. Servings
  const servings = Math.max(
    1,
    Math.min(20, parseInt(recipeData.servings, 10) || cleanServings || 2)
  );

  // 4. Timings & Difficulty
  const prepTimeMinutes = Math.max(
    0,
    Math.min(360, parseInt(recipeData.prepTimeMinutes, 10) || 10)
  );
  const cookTimeMinutes = Math.max(
    5,
    Math.min(360, parseInt(recipeData.cookTimeMinutes, 10) || cleanCookingTime || 20)
  );

  const prepTime = typeof recipeData.prepTime === "string" && recipeData.prepTime.trim()
    ? recipeData.prepTime.trim()
    : `${prepTimeMinutes} mins`;
  const cookTime = typeof recipeData.cookTime === "string" && recipeData.cookTime.trim()
    ? recipeData.cookTime.trim()
    : `${cookTimeMinutes} mins`;

  const validDifficulties = ["Easy", "Medium", "Advanced"];
  const difficulty = typeof recipeData.difficulty === "string" && validDifficulties.includes(recipeData.difficulty.trim())
    ? recipeData.difficulty.trim()
    : "Easy";

  // 5. Ingredients
  let rawIngredients = Array.isArray(recipeData.ingredients) && recipeData.ingredients.length > 0
    ? recipeData.ingredients
    : fallbackCleanItems;

  const sanitizedIngredients = [];
  for (const item of rawIngredients) {
    if (typeof item === "string") {
      const parsed = parseIngredientString(item);
      if (parsed) sanitizedIngredients.push(parsed);
    } else if (typeof item === "object" && item !== null) {
      const name = typeof item.name === "string" && item.name.trim()
        ? item.name.trim().slice(0, 100)
        : "";
      if (name) {
        let qty = item.quantity;
        if (typeof qty === "string") {
          const parsedNum = parseFloat(qty);
          qty = Number.isFinite(parsedNum) ? parsedNum : null;
        } else if (typeof qty !== "number" || !Number.isFinite(qty)) {
          qty = null;
        }

        sanitizedIngredients.push({
          name,
          quantity: qty !== null ? Math.round(qty * 100) / 100 : null,
          unit: typeof item.unit === "string" ? item.unit.trim().slice(0, 30) : "",
          optional: Boolean(item.optional),
        });
      }
    }
  }

  // If empty after processing, fallback to cleaned input items
  if (sanitizedIngredients.length === 0) {
    for (const item of fallbackCleanItems) {
      const parsed = parseIngredientString(item);
      if (parsed) sanitizedIngredients.push(parsed);
    }
  }

  // 6. Instructions
  let rawInstructions = Array.isArray(recipeData.instructions) && recipeData.instructions.length > 0
    ? recipeData.instructions
    : ["Prepare ingredients and cook to taste."];

  const sanitizedInstructions = rawInstructions.map((step, idx) => parseInstructionItem(step, idx));

  // 7. Substitutions
  const sanitizedSubstitutions = [];
  if (Array.isArray(recipeData.substitutions)) {
    for (const sub of recipeData.substitutions) {
      if (typeof sub === "object" && sub !== null) {
        const original = typeof sub.original === "string" ? sub.original.trim().slice(0, 100) : "";
        const replacement = typeof sub.replacement === "string" ? sub.replacement.trim().slice(0, 100) : "";
        if (original && replacement) {
          sanitizedSubstitutions.push({
            original,
            replacement,
            ratio: typeof sub.ratio === "string" ? sub.ratio.trim().slice(0, 50) : "1:1",
            notes: typeof sub.notes === "string" ? sub.notes.trim().slice(0, 300) : "",
          });
        }
      }
    }
  }

  // 8. Dietary Notes
  const sanitizedDietaryNotes = [];
  if (Array.isArray(recipeData.dietaryNotes)) {
    for (const note of recipeData.dietaryNotes) {
      if (typeof note === "string" && note.trim()) {
        sanitizedDietaryNotes.push(note.trim().slice(0, 50));
      }
    }
  }

  // 9. Nutrition Information (Validate or set to null if unreliable)
  let sanitizedNutrition = null;
  if (recipeData.nutrition && typeof recipeData.nutrition === "object") {
    const rawCal = recipeData.nutrition.calories;
    const caloriesNum = typeof rawCal === "number"
      ? rawCal
      : typeof rawCal === "string"
        ? parseInt(rawCal.replace(/[^\d]/g, ""), 10)
        : null;

    if (caloriesNum && caloriesNum > 0 && caloriesNum <= 5000) {
      sanitizedNutrition = {
        calories: caloriesNum,
        protein: typeof recipeData.nutrition.protein === "string" ? recipeData.nutrition.protein.trim().slice(0, 20) : "N/A",
        carbs: typeof recipeData.nutrition.carbs === "string" ? recipeData.nutrition.carbs.trim().slice(0, 20) : "N/A",
        fat: typeof recipeData.nutrition.fat === "string" ? recipeData.nutrition.fat.trim().slice(0, 20) : "N/A",
        fiber: typeof recipeData.nutrition.fiber === "string" ? recipeData.nutrition.fiber.trim().slice(0, 20) : "N/A",
      };
    }
  }

  // 10. Tips
  const sanitizedTips = [];
  if (Array.isArray(recipeData.tips)) {
    for (const tip of recipeData.tips) {
      if (typeof tip === "string" && tip.trim()) {
        sanitizedTips.push(tip.trim().slice(0, 300));
      }
    }
  }

  return {
    title,
    description,
    ingredients: sanitizedIngredients,
    instructions: sanitizedInstructions,
    prepTime,
    cookTime,
    prepTimeMinutes,
    cookTimeMinutes,
    difficulty,
    servings,
    substitutions: sanitizedSubstitutions,
    dietaryNotes: sanitizedDietaryNotes,
    nutrition: sanitizedNutrition,
    tips: sanitizedTips,
  };
}

/**
 * Generate a new recipe using Gemini and save it to MongoDB.
 */
export async function generateRecipe(req, res) {
  try {
    const {
      ingredients,
      meal = "Dinner",
      cuisine = "Any cuisine",
      diet = "No preference",
      cookingTime = "30",
      servings = "2",
      spiceLevel = "No preference",
      cookingInstructions = "",
      language = "English",
    } = req.body;

    let cleanIngredientsData;
    try {
      cleanIngredientsData = validateAndNormalizeIngredients(ingredients);
    } catch (valErr) {
      return res.status(400).json({
        success: false,
        message: valErr.message,
      });
    }

    let cleanCookingPreferences;
    try {
      cleanCookingPreferences = validateAndSanitizeCookingPreferences({
        spiceLevel,
        cookingInstructions,
      });
    } catch (prefErr) {
      return res.status(400).json({
        success: false,
        message: prefErr.message,
      });
    }

    const { cleanItems, combinedString } = cleanIngredientsData;
    const { cleanSpice, cleanInstructions } = cleanCookingPreferences;
    const cleanLanguage = normalizeRecipeLanguage(language);

    const cleanServings = Math.max(1, Math.min(20, parseInt(servings, 10) || 2));
    const cleanCookingTime = Math.max(5, Math.min(360, parseInt(cookingTime, 10) || 30));
    const cleanMeal = typeof meal === "string" ? meal.slice(0, 50).trim() : "Dinner";
    const cleanCuisine = typeof cuisine === "string" ? cuisine.slice(0, 50).trim() : "Any cuisine";
    const cleanDiet = typeof diet === "string" ? diet.slice(0, 50).trim() : "No preference";

    const recipeData = await generateRecipeWithAI({
      ingredients: combinedString,
      meal: cleanMeal,
      cuisine: cleanCuisine,
      diet: cleanDiet,
      cookingTime: String(cleanCookingTime),
      servings: String(cleanServings),
      spiceLevel: cleanSpice,
      cookingInstructions: cleanInstructions,
      language: cleanLanguage,
    });

    const sanitizedRecipe = validateAndSanitizeRecipeData(
      recipeData,
      cleanItems,
      cleanCookingTime,
      cleanServings
    );

    const savedRecipe = await Recipe.create({
      ...sanitizedRecipe,
      meal: cleanMeal,
      cuisine: cleanCuisine,
      diet: cleanDiet,
      spiceLevel: cleanSpice,
      cookingInstructions: cleanInstructions,
      language: cleanLanguage,
      owner: req.user.userId,
    });

    return res.json({
      success: true,
      message: "Recipe generated and saved successfully!",
      recipe: savedRecipe,
    });
  } catch (error) {
    console.error("Recipe generation error:", error.message);

    return res.status(500).json({
      success: false,
      message: sanitizeErrorMessage(error.message, "Failed to generate the recipe."),
    });
  }
}

/**
 * Retrieve all recipes owned by the logged-in user.
 */
export async function getRecipes(req, res) {
  try {
    const recipes = await Recipe.find({
      owner: req.user.userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: recipes.length,
      recipes,
    });
  } catch (error) {
    console.error("Failed to fetch recipes:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve saved recipes.",
    });
  }
}

/**
 * Toggle the favorite status of a recipe.
 */
export async function toggleFavorite(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid recipe ID format.",
      });
    }

    const recipe = await Recipe.findOne({
      _id: req.params.id,
      owner: req.user.userId,
    });

    if (!recipe) {
      return res.status(404).json({
        success: false,
        message: "Recipe not found.",
      });
    }

    recipe.isFavorite = !recipe.isFavorite;
    await recipe.save();

    return res.json({
      success: true,
      recipe,
    });
  } catch (error) {
    console.error("Favorite update failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update favorite status.",
    });
  }
}

/**
 * Delete a recipe by ID.
 */
export async function deleteRecipe(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid recipe ID format.",
      });
    }

    const recipe = await Recipe.findOneAndDelete({
      _id: req.params.id,
      owner: req.user.userId,
    });

    if (!recipe) {
      return res.status(404).json({
        success: false,
        message: "Recipe not found.",
      });
    }

    return res.json({
      success: true,
      message: "Recipe deleted successfully.",
    });
  } catch (error) {
    console.error("Recipe deletion failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to delete recipe.",
    });
  }
}

/**
 * Context-aware recipe chat assistant.
 * Handles questions, modifications, and clarifications for a recipe.
 */
export async function recipeChat(req, res) {
  try {
    const { message, history = [], recipe, recipeId } = req.body;
    const targetRecipeId = req.params.id || recipeId;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid question or message.",
      });
    }

    const cleanMessage = message.trim();
    if (cleanMessage.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Message exceeds maximum length of 500 characters.",
      });
    }

    let activeRecipe = null;

    if (targetRecipeId) {
      if (!mongoose.isValidObjectId(targetRecipeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid recipe ID format.",
        });
      }

      activeRecipe = await Recipe.findOne({
        _id: targetRecipeId,
        owner: req.user.userId,
      }).lean();

      if (!activeRecipe) {
        return res.status(404).json({
          success: false,
          message: "Recipe not found or you do not have permission to access it.",
        });
      }
    } else if (recipe && typeof recipe === "object") {
      // If recipe object has an _id, ensure it is valid format and verify ownership
      if (recipe._id) {
        if (!mongoose.isValidObjectId(recipe._id)) {
          return res.status(400).json({
            success: false,
            message: "Invalid recipe ID format.",
          });
        }
        const existing = await Recipe.findOne({
          _id: recipe._id,
          owner: req.user.userId,
        }).lean();
        if (!existing) {
          return res.status(404).json({
            success: false,
            message: "Recipe not found or you do not have permission to access it.",
          });
        }
      }
      activeRecipe = recipe;
    }

    if (!activeRecipe || !activeRecipe.title) {
      return res.status(400).json({
        success: false,
        message: "Valid recipe context is required for chat.",
      });
    }

    if (history !== undefined && !Array.isArray(history)) {
      return res.status(400).json({
        success: false,
        message: "History must be an array of conversation messages.",
      });
    }

    if (Array.isArray(history) && history.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Conversation history exceeds maximum allowed length of 10 messages.",
      });
    }

    // Sanitize conversation history
    const cleanHistory = Array.isArray(history)
      ? history
          .filter((h) => h && typeof h === "object" && typeof h.content === "string")
          .map((h) => ({
            role: h.role === "assistant" ? "assistant" : "user",
            content: h.content.slice(0, 500).trim(),
          }))
      : [];

    const aiResult = await chatAboutRecipeWithAI({
      recipe: activeRecipe,
      message: cleanMessage,
      history: cleanHistory,
    });

    if (!aiResult || typeof aiResult !== "object") {
      throw new Error("Invalid response received from culinary assistant.");
    }

    const responseType =
      aiResult.type === "recipe_update"
        ? "recipe_update"
        : aiResult.type === "clarification"
          ? "clarification"
          : "answer";

    const responseMessage =
      typeof aiResult.message === "string" && aiResult.message.trim()
        ? aiResult.message.trim()
        : "I have reviewed your request.";

    if (responseType === "recipe_update") {
      if (aiResult.updatedRecipe && typeof aiResult.updatedRecipe === "object") {
        const fallbackItems = Array.isArray(activeRecipe.ingredients)
          ? activeRecipe.ingredients.map((i) => (typeof i === "string" ? i : i.name))
          : [];

        const sanitizedUpdate = validateAndSanitizeRecipeData(
          aiResult.updatedRecipe,
          fallbackItems,
          activeRecipe.cookTimeMinutes || 20,
          activeRecipe.servings || 2
        );
        sanitizedUpdate.language = activeRecipe.language || "English";

        const safeChanges = Array.isArray(aiResult.changes)
          ? aiResult.changes
              .filter((c) => c && typeof c === "object")
              .map((c) => ({
                field: typeof c.field === "string" ? c.field.slice(0, 50) : "recipe",
                description:
                  typeof c.description === "string"
                    ? c.description.slice(0, 200)
                    : "Updated recipe details",
              }))
          : [{ field: "recipe", description: "Recipe modified per your request" }];

        return res.json({
          success: true,
          response: {
            type: "recipe_update",
            message: responseMessage,
            changes: safeChanges,
            updatedRecipe: sanitizedUpdate,
          },
        });
      } else {
        // Fallback to answer if updatedRecipe is missing
        return res.json({
          success: true,
          response: {
            type: "answer",
            message: responseMessage,
          },
        });
      }
    }

    return res.json({
      success: true,
      response: {
        type: responseType,
        message: responseMessage,
      },
    });
  } catch (error) {
    console.error("Recipe chat error:", error.message);
    return res.status(500).json({
      success: false,
      message: sanitizeErrorMessage(error.message, "Failed to process recipe assistant request."),
    });
  }
}

/**
 * Saves a customized or modified recipe as a new entry in the user's cookbook.
 */
export async function saveCustomRecipe(req, res) {
  try {
    const { recipe } = req.body;
    if (!recipe || typeof recipe !== "object" || !recipe.title) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid recipe object to save.",
      });
    }

    const sanitized = validateAndSanitizeRecipeData(
      recipe,
      [],
      recipe.cookTimeMinutes || 20,
      recipe.servings || 2
    );

    const savedRecipe = await Recipe.create({
      ...sanitized,
      meal: typeof recipe.meal === "string" ? recipe.meal.slice(0, 50) : "Dinner",
      cuisine: typeof recipe.cuisine === "string" ? recipe.cuisine.slice(0, 50) : "Any cuisine",
      diet: typeof recipe.diet === "string" ? recipe.diet.slice(0, 50) : "No preference",
      spiceLevel: typeof recipe.spiceLevel === "string" ? recipe.spiceLevel.slice(0, 30) : "No preference",
      cookingInstructions: typeof recipe.cookingInstructions === "string" ? recipe.cookingInstructions.slice(0, 500) : "",
      language: normalizeRecipeLanguage(recipe.language),
      owner: req.user.userId,
    });

    return res.status(201).json({
      success: true,
      message: "Customized recipe saved to your cookbook!",
      recipe: savedRecipe,
    });
  } catch (error) {
    console.error("Save custom recipe error:", error.message);
    return res.status(500).json({
      success: false,
      message: sanitizeErrorMessage(error.message, "Unable to save customized recipe."),
    });
  }
}
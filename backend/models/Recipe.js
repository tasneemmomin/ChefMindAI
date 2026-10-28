
import mongoose from "mongoose";

const recipeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

owner: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true,
  index: true,
},


    description: {
      type: String,
      default: "",
    },

    ingredients: {
      type: [mongoose.Schema.Types.Mixed],
      required: true,
    },

    instructions: {
      type: [mongoose.Schema.Types.Mixed],
      required: true,
    },

    prepTime: {
      type: String,
      default: "",
    },

    cookTime: {
      type: String,
      default: "",
    },

    prepTimeMinutes: {
      type: Number,
      default: 10,
    },

    cookTimeMinutes: {
      type: Number,
      default: 20,
    },

    difficulty: {
      type: String,
      default: "Easy",
    },

    servings: {
      type: Number,
      default: 2,
    },

    substitutions: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    dietaryNotes: {
      type: [String],
      default: [],
    },

    nutrition: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    tips: {
      type: [String],
      default: [],
    },

    meal: {
      type: String,
      default: "Dinner",
    },

    cuisine: {
      type: String,
      default: "Any cuisine",
    },

    diet: {
      type: String,
      default: "No preference",
    },

    spiceLevel: {
      type: String,
      default: "No preference",
    },

    cookingInstructions: {
      type: String,
      default: "",
    },

    language: {
      type: String,
      default: "English",
      trim: true,
    },

    isFavorite: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for optimal sorting and query performance on cookbook retrieval
recipeSchema.index({ owner: 1, createdAt: -1 });

const Recipe = mongoose.model("Recipe", recipeSchema);

export default Recipe;

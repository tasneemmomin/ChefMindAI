import express from "express";
import {
  generateRecipe,
  getRecipes,
  toggleFavorite,
  deleteRecipe,
  recipeChat,
  saveCustomRecipe,
} from "../controllers/recipeController.js";
import { authenticateToken } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.use(authenticateToken);

router.post("/generate", aiLimiter, generateRecipe);
router.post("/chat", aiLimiter, recipeChat);
router.post("/save", saveCustomRecipe);
router.post("/:id/chat", aiLimiter, recipeChat);
router.get("/", getRecipes);
router.patch("/:id/favorite", toggleFavorite);
router.delete("/:id", deleteRecipe);

export default router;

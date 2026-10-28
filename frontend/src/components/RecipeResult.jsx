import { useState } from "react";
import { scaleIngredient } from "../utils/recipeScaler";
import RecipeChat from "./RecipeChat";

function RecipeResult({
  loading,
  error,
  recipe,
  onApplyRecipeUpdate,
  onSaveCustomRecipe,
  authToken,
}) {
  const baseServings = recipe?.servings ? Math.max(1, parseInt(recipe.servings, 10)) : 2;
  const recipeKey = recipe?._id || recipe?.title || "";

  const [prevRecipeKey, setPrevRecipeKey] = useState(recipeKey);
  const [servingsOverride, setServingsOverride] = useState(null);
  const [checkedIngredients, setCheckedIngredients] = useState(() => new Set());
  const [checkedSteps, setCheckedSteps] = useState(() => new Set());

  // Idiomatic React pattern: reset state during render when prop changes
  if (recipeKey !== prevRecipeKey) {
    setPrevRecipeKey(recipeKey);
    setServingsOverride(null);
    setCheckedIngredients(new Set());
    setCheckedSteps(new Set());
  }

  const currentServings = servingsOverride !== null ? servingsOverride : baseServings;

  if (loading) {
    return (
      <section className="recipe-result" aria-live="polite">
        <div className="loading-spinner" />
        <h2>Your AI chef is at work...</h2>
        <p>Finding something delicious with your confirmed ingredients.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="recipe-result error-message" role="alert">
        <h2>Oops! Something went wrong.</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (!recipe) {
    return null;
  }

  const scaleRatio = baseServings > 0 ? currentServings / baseServings : 1;
  const isScaled = currentServings !== baseServings;

  const rawIngredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
    : typeof recipe.ingredients === "string"
      ? [recipe.ingredients]
      : [];

  const rawInstructions = Array.isArray(recipe.instructions)
    ? recipe.instructions
    : typeof recipe.instructions === "string"
      ? [recipe.instructions]
      : [];

  const substitutionsList = Array.isArray(recipe.substitutions) ? recipe.substitutions : [];
  const dietaryNotesList = Array.isArray(recipe.dietaryNotes) ? recipe.dietaryNotes : [];
  const tipsList = Array.isArray(recipe.tips) ? recipe.tips : [];
  const nutrition = recipe.nutrition && typeof recipe.nutrition === "object" ? recipe.nutrition : null;

  const difficulty = recipe.difficulty || "Easy";
  const prepDisplay = recipe.prepTime || (recipe.prepTimeMinutes ? `${recipe.prepTimeMinutes} mins` : "10 mins");
  const cookDisplay = recipe.cookTime || (recipe.cookTimeMinutes ? `${recipe.cookTimeMinutes} mins` : "20 mins");

  const toggleIngredientCheck = (idx) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleStepCheck = (idx) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleDecreaseServings = () => {
    if (currentServings > 1) {
      setServingsOverride(currentServings - 1);
    }
  };

  const handleIncreaseServings = () => {
    if (currentServings < 20) {
      setServingsOverride(currentServings + 1);
    }
  };

  const handleResetServings = () => {
    setServingsOverride(null);
  };

  return (
    <section className="recipe-result recipe-card-advanced" aria-labelledby="recipe-title-heading">
      <div className="recipe-header-bar">
        <span className="eyebrow">YOUR CHEFMIND CREATION</span>
        <div className="recipe-tags-row">
          {recipe.meal && <span className="recipe-pill pill-meal">🍽 {recipe.meal}</span>}
          {recipe.cuisine && <span className="recipe-pill pill-cuisine">🌍 {recipe.cuisine}</span>}
          {recipe.spiceLevel && recipe.spiceLevel !== "No preference" && (
            <span className="recipe-pill pill-spice">🌶️ {recipe.spiceLevel}</span>
          )}
          {recipe.language === "Hindi" && (
            <span className="recipe-pill pill-language">🇮🇳 हिन्दी</span>
          )}
          {difficulty && (
            <span
              className={`recipe-pill pill-difficulty ${
                difficulty.toLowerCase() === "advanced"
                  ? "pill-advanced"
                  : difficulty.toLowerCase() === "medium"
                    ? "pill-medium"
                    : "pill-easy"
              }`}
            >
              ⭐ {difficulty}
            </span>
          )}
        </div>
      </div>

      <h2 id="recipe-title-heading" className="recipe-title">
        {recipe.title}
      </h2>

      {recipe.description && (
        <p className="recipe-description">{recipe.description}</p>
      )}

      {recipe.cookingInstructions && (
        <div className="recipe-custom-instructions-badge">
          <span className="custom-instructions-badge-icon" aria-hidden="true">✨</span>
          <span>
            Prepared per your instructions: <em>&ldquo;{recipe.cookingInstructions}&rdquo;</em>
          </span>
        </div>
      )}

      {/* Meta Bar & Dynamic Servings Scaler */}
      <div className="recipe-meta-advanced">
        <div className="meta-stat">
          <span className="meta-icon">⏱</span>
          <div>
            <strong>{prepDisplay}</strong>
            <span className="meta-label">Prep time</span>
          </div>
        </div>

        <div className="meta-stat">
          <span className="meta-icon">🔥</span>
          <div>
            <strong>{cookDisplay}</strong>
            <span className="meta-label">Cook time</span>
          </div>
        </div>

        <div className="meta-stat meta-servings-scaler">
          <span className="meta-icon">👥</span>
          <div>
            <div className="scaler-controls">
              <button
                type="button"
                className="scaler-btn"
                onClick={handleDecreaseServings}
                disabled={currentServings <= 1}
                aria-label="Decrease servings"
              >
                −
              </button>
              <strong className="scaler-value">
                {currentServings} {currentServings === 1 ? "serving" : "servings"}
              </strong>
              <button
                type="button"
                className="scaler-btn"
                onClick={handleIncreaseServings}
                disabled={currentServings >= 20}
                aria-label="Increase servings"
              >
                +
              </button>
            </div>
            <div className="scaler-meta-row">
              <span className="meta-label">Serving size</span>
              {isScaled && (
                <button
                  type="button"
                  className="scaler-reset-btn"
                  onClick={handleResetServings}
                  title="Reset to original serving size"
                >
                  ↺ Reset ({baseServings})
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {isScaled && (
        <div className="scale-notice-banner" role="status">
          <span>
            ⚡ <strong>Proportionally scaled to {currentServings} servings</strong> ({scaleRatio.toFixed(2)}x baseline). Ingredient quantities update automatically below.
          </span>
        </div>
      )}

      <div className="recipe-layout-grid">
        {/* Ingredients Column */}
        <div className="recipe-column ingredients-column">
          <div className="column-header">
            <h3>Ingredients</h3>
            <span className="column-subtitle">
              {rawIngredients.length} items {isScaled ? `(scaled for ${currentServings})` : ""}
            </span>
          </div>

          <ul className="ingredients-checklist" aria-label="Ingredients list">
            {rawIngredients.map((item, index) => {
              const scaled = scaleIngredient(item, scaleRatio);
              const isChecked = checkedIngredients.has(index);

              return (
                <li
                  key={index}
                  className={`ingredient-item ${isChecked ? "item-checked" : ""} ${
                    scaled.optional ? "item-optional" : ""
                  }`}
                  onClick={() => toggleIngredientCheck(index)}
                >
                  <label className="checkbox-container" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleIngredientCheck(index)}
                      aria-label={`Mark ${scaled.name || scaled.displayText} as prepared`}
                    />
                    <span className="checkmark" />
                  </label>

                  <div className="ingredient-text-block">
                    <span className="ingredient-text">
                      {scaled.displayQuantity && (
                        <strong className="ingredient-qty">
                          {scaled.displayQuantity} {scaled.unit}{" "}
                        </strong>
                      )}
                      <span className="ingredient-name">{scaled.name || scaled.displayText}</span>
                    </span>

                    {scaled.isSpiceCaution && (
                      <span className="spice-caution-hint" title="Spices do not scale strictly linear; adjust to taste">
                        (adjust to taste)
                      </span>
                    )}
                  </div>

                  {scaled.optional && (
                    <span className="optional-badge" title="This ingredient is optional">
                      Optional
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Cooking Instructions Column */}
        <div className="recipe-column instructions-column">
          <div className="column-header">
            <h3>Cooking Instructions</h3>
            <span className="column-subtitle">
              {rawInstructions.length} sequential steps
            </span>
          </div>

          <ol className="instructions-steplist" aria-label="Cooking steps">
            {rawInstructions.map((step, index) => {
              const isChecked = checkedSteps.has(index);
              const isObj = typeof step === "object" && step !== null;
              const stepNumber = isObj && step.step ? step.step : index + 1;
              const stepTitle = isObj && step.title ? step.title : `Step ${stepNumber}`;
              const stepDesc = isObj && step.description ? step.description : String(step);

              return (
                <li
                  key={index}
                  className={`instruction-step ${isChecked ? "step-done" : ""}`}
                  onClick={() => toggleStepCheck(index)}
                >
                  <div className="step-header-row">
                    <div className="step-pill-badge">
                      Step {stepNumber.toString().padStart(2, "0")}
                    </div>
                    {stepTitle && <strong className="step-title-text">{stepTitle}</strong>}
                    <button
                      type="button"
                      className={`step-checkbox-btn ${isChecked ? "btn-done" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStepCheck(index);
                      }}
                      aria-label={isChecked ? `Step ${stepNumber} completed` : `Mark step ${stepNumber} done`}
                    >
                      {isChecked ? "✓ Done" : "Mark done"}
                    </button>
                  </div>
                  <p className="step-description-text">{stepDesc}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* Ingredient Substitutions */}
      {substitutionsList.length > 0 && (
        <div className="recipe-section-card substitutions-card">
          <div className="section-title-row">
            <span className="section-icon">🔄</span>
            <div>
              <h3>Smart Ingredient Substitutions</h3>
              <p>Practical pantry alternatives with tailored ratios and culinary notes.</p>
            </div>
          </div>

          <div className="substitutions-grid">
            {substitutionsList.map((sub, idx) => (
              <div key={idx} className="substitution-box">
                <div className="sub-header">
                  <span className="sub-original">{sub.original}</span>
                  <span className="sub-arrow">➔</span>
                  <span className="sub-replacement">{sub.replacement}</span>
                  {sub.ratio && <span className="sub-ratio-badge">{sub.ratio} ratio</span>}
                </div>
                {sub.notes && <p className="sub-notes">{sub.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dietary Notes */}
      {dietaryNotesList.length > 0 && (
        <div className="recipe-section-card dietary-card">
          <div className="section-title-row">
            <span className="section-icon">🌱</span>
            <div>
              <h3>Dietary & Allergen Notes</h3>
            </div>
          </div>
          <div className="dietary-tags-list">
            {dietaryNotesList.map((note, idx) => (
              <span key={idx} className="dietary-tag">
                ✓ {note}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Nutrition Information (Only rendered when nutrition is available) */}
      {nutrition && (
        <div className="recipe-section-card nutrition-card">
          <div className="section-title-row">
            <span className="section-icon">📊</span>
            <div>
              <h3>Nutritional Estimates</h3>
              <p className="nutrition-disclaimer">
                *Estimated values per serving. Actual values vary based on specific brands, exact measurements, and cooking oils.
              </p>
            </div>
          </div>

          <div className="nutrition-grid">
            <div className="nutrition-stat-box">
              <span className="nutrition-val">{nutrition.calories || "N/A"}</span>
              <span className="nutrition-lbl">Calories (kcal)</span>
            </div>
            <div className="nutrition-stat-box">
              <span className="nutrition-val">{nutrition.protein || "N/A"}</span>
              <span className="nutrition-lbl">Protein</span>
            </div>
            <div className="nutrition-stat-box">
              <span className="nutrition-val">{nutrition.carbs || "N/A"}</span>
              <span className="nutrition-lbl">Carbs</span>
            </div>
            <div className="nutrition-stat-box">
              <span className="nutrition-val">{nutrition.fat || "N/A"}</span>
              <span className="nutrition-lbl">Fat</span>
            </div>
            {nutrition.fiber && nutrition.fiber !== "N/A" && (
              <div className="nutrition-stat-box">
                <span className="nutrition-val">{nutrition.fiber}</span>
                <span className="nutrition-lbl">Fiber</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chef's Tips */}
      {tipsList.length > 0 && (
        <div className="recipe-section-card tips-card">
          <div className="section-title-row">
            <span className="section-icon">💡</span>
            <div>
              <h3>Chef's Pro Tips</h3>
            </div>
          </div>
          <ul className="recipe-tips-list">
            {tipsList.map((tip, index) => (
              <li key={index}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Interactive Cooking Assistant Chat Panel */}
      <RecipeChat
        recipe={recipe}
        onApplyRecipeUpdate={onApplyRecipeUpdate}
        onSaveCustomRecipe={onSaveCustomRecipe}
        authToken={authToken}
      />
    </section>
  );
}

export default RecipeResult;

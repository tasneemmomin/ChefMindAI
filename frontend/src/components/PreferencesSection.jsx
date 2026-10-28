function PreferencesSection({
  meal,
  setMeal,
  cuisine,
  setCuisine,
  diet,
  setDiet,
  cookingTime,
  setCookingTime,
  servings,
  setServings,
  language = "English",
  setLanguage,
  spiceLevel = "No preference",
  setSpiceLevel,
  cookingInstructions = "",
  setCookingInstructions,
  loading,
  isConfirmed = false,
  confirmedCount = 0,
}) {
  const MAX_INSTRUCTIONS_LENGTH = 500;
  const charsRemaining = MAX_INSTRUCTIONS_LENGTH - (cookingInstructions ? cookingInstructions.length : 0);
  const isNearLimit = charsRemaining <= 50;

  return (
    <>
      <div className="meal-grid">
        {[
          { name: "Breakfast", icon: "☀", detail: "A fresh start" },
          { name: "Lunch", icon: "◉", detail: "Midday favorites" },
          { name: "Dinner", icon: "☾", detail: "Evening comfort" },
        ].map((option) => (
          <button
            type="button"
            key={option.name}
            className={`meal-option ${meal === option.name ? "selected" : ""}`}
            onClick={() => setMeal(option.name)}
          >
            <span className="meal-icon">{option.icon}</span>
            <strong>{option.name}</strong>
            <span className="meal-detail">{option.detail}</span>
            {meal === option.name && <span className="selected-check">✓</span>}
          </button>
        ))}
      </div>

      <div className="section-divider" />

      <section className="section">
        <div className="section-heading">
          <span className="step-number">03</span>
          <div>
            <h2>Make it your own</h2>
            <p>Customize your meal preferences and guide your AI chef.</p>
          </div>
        </div>

        <div className="preferences-grid">
          <label className="field">
            <span>Cuisine preference</span>
            <select
              id="preference-cuisine-select"
              value={cuisine}
              onChange={(event) => setCuisine(event.target.value)}
            >
              <option value="Any cuisine">No preference / Any cuisine</option>
              <option value="North Indian">North Indian</option>
              <option value="South Indian">South Indian</option>
              <option value="Indo-Chinese">Indo-Chinese</option>
              <option value="Indian">Indian (General)</option>
              <option value="Italian">Italian</option>
              <option value="Chinese">Chinese</option>
              <option value="Mexican">Mexican</option>
              <option value="Thai">Thai</option>
              <option value="Mediterranean">Mediterranean</option>
            </select>
          </label>

          <label className="field">
            <span>Dietary preference</span>
            <select
              value={diet}
              onChange={(event) => setDiet(event.target.value)}
            >
              <option>No preference</option>
              <option>Vegetarian</option>
              <option>Vegan</option>
              <option>High protein</option>
              <option>Gluten-free</option>
            </select>
          </label>

          <label className="field">
            <span>Cooking time</span>
            <select
              value={cookingTime}
              onChange={(event) => setCookingTime(event.target.value)}
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">60 minutes</option>
            </select>
          </label>

          <label className="field">
            <span>Servings</span>
            <select
              value={servings}
              onChange={(event) => setServings(event.target.value)}
            >
              <option value="1">1 person</option>
              <option value="2">2 people</option>
              <option value="4">4 people</option>
              <option value="6">6 people</option>
            </select>
          </label>

          <label className="field">
            <span>Recipe language</span>
            <select
              id="preference-language-select"
              value={language}
              onChange={(event) => setLanguage && setLanguage(event.target.value)}
            >
              <option value="English">English</option>
              <option value="Hindi">हिन्दी (Hindi)</option>
            </select>
          </label>
        </div>

        {/* Optional "How would you like your dish?" section */}
        <div className="cooking-instructions-panel">
          <div className="instructions-panel-header">
            <div className="instructions-title-block">
              <span className="instructions-badge">Optional</span>
              <h3 className="instructions-title">
                How would you like your dish?
              </h3>
            </div>
            <span
              className={`instructions-char-counter ${isNearLimit ? "counter-near-limit" : ""}`}
              aria-live="polite"
              aria-label="Character count"
            >
              {(cookingInstructions || "").length}/{MAX_INSTRUCTIONS_LENGTH}
            </span>
          </div>

          <p className="instructions-subtitle">
            Customize the flavor, preparation, and cooking style. Your AI chef will use your preferences to create a recipe that suits you.
          </p>

          <div className="instructions-grid">
            <div className="field spice-selector-field">
              <label htmlFor="preference-spice-select">
                <span>Spice level</span>
              </label>
              <select
                id="preference-spice-select"
                value={spiceLevel}
                onChange={(event) => setSpiceLevel && setSpiceLevel(event.target.value)}
              >
                <option value="No preference">No preference</option>
                <option value="Mild">Mild</option>
                <option value="Medium">Medium</option>
                <option value="Spicy">Spicy</option>
                <option value="Extra spicy">Extra spicy</option>
              </select>
            </div>

            <div className="field custom-notes-field">
              <label htmlFor="cooking-instructions-textarea">
                <span>Any special instructions?</span>
              </label>
              <textarea
                id="cooking-instructions-textarea"
                className="instructions-textarea"
                rows={3}
                maxLength={MAX_INSTRUCTIONS_LENGTH}
                value={cookingInstructions}
                onChange={(event) => {
                  if (event.target.value.length <= MAX_INSTRUCTIONS_LENGTH) {
                    setCookingInstructions && setCookingInstructions(event.target.value);
                  }
                }}
                placeholder="e.g. Make it spicy, use boiled eggs instead of an omelette, prepare it in North Indian style, or make a thick gravy..."
              />
              <p className="instructions-helper-text">
                Your AI chef will consider these instructions when creating your recipe.
              </p>
              {charsRemaining <= 0 && (
                <span className="instructions-limit-alert" role="alert">
                  Maximum length of 500 characters reached.
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="generate-controls-container">
        {!isConfirmed ? (
          <p className="generate-guidance-warning">
            ⚠️ Please review and click <strong>&ldquo;Confirm ingredients&rdquo;</strong> in Step 02 before generating your recipe.
          </p>
        ) : confirmedCount > 0 ? (
          <p className="generate-guidance-success">
            ✓ Ready with {confirmedCount} confirmed ingredient{confirmedCount !== 1 ? "s" : ""}!
          </p>
        ) : (
          <p className="generate-guidance-warning">
            ⚠️ Add at least one ingredient and confirm in Step 02.
          </p>
        )}

        <button
          className="generate-button"
          type="submit"
          disabled={loading || !isConfirmed || confirmedCount === 0}
        >
          <span>✳</span> {loading ? "Generating..." : "Find my recipes"}{" "}
          <span className="button-arrow">→</span>
        </button>
      </div>

      <p className="privacy-note">
        Made for your kitchen, your tastes, and your ingredients.
      </p>
    </>
  );
}

export default PreferencesSection;


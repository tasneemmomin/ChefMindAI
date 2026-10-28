import { useState, useEffect, useCallback, useRef } from "react";

function HeartIcon({ filled = false, className = "" }) {
  if (filled) {
    return (
      <svg
        className={`btn-icon heart-icon filled ${className}`}
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    );
  }
  return (
    <svg
      className={`btn-icon heart-icon outline ${className}`}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function TrashIcon({ className = "" }) {
  return (
    <svg
      className={`btn-icon trash-icon ${className}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function Cookbook({
  recipes,
  loading,
  error,
  onLoadRecipes,
  onToggleFavorite,
  onDeleteRecipe,
}) {
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [recipeToDelete, setRecipeToDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const previousActiveElementRef = useRef(null);
  const deleteModalRef = useRef(null);
  const cancelBtnRef = useRef(null);

  const safeRecipes = Array.isArray(recipes) ? recipes : [];
  const displayedRecipes = safeRecipes.filter(
    (item) => !showFavoritesOnly || item.isFavorite
  );

  const handleOpenDeleteModal = (item) => {
    previousActiveElementRef.current = document.activeElement;
    setRecipeToDelete(item);
    setDeleteError("");
  };

  const handleCloseDeleteModal = useCallback(() => {
    if (deletingId) return;
    setRecipeToDelete(null);
    setDeleteError("");
    if (
      previousActiveElementRef.current &&
      typeof previousActiveElementRef.current.focus === "function"
    ) {
      setTimeout(() => {
        previousActiveElementRef.current?.focus();
      }, 50);
    }
  }, [deletingId]);

  // Trap focus and handle Escape inside delete confirmation modal
  useEffect(() => {
    if (!recipeToDelete) return;

    // Auto-focus the cancel button for safe keyboard accessibility
    setTimeout(() => {
      cancelBtnRef.current?.focus();
    }, 50);

    function handleModalKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseDeleteModal();
        return;
      }

      if (e.key === "Tab" && deleteModalRef.current) {
        const focusableSelectors = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(deleteModalRef.current.querySelectorAll(focusableSelectors));
        if (focusables.length === 0) return;

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    }

    window.addEventListener("keydown", handleModalKeyDown);
    return () => window.removeEventListener("keydown", handleModalKeyDown);
  }, [recipeToDelete, handleCloseDeleteModal]);

  const handleConfirmDelete = async () => {
    if (!recipeToDelete || deletingId) return;
    const id = recipeToDelete._id;
    setDeletingId(id);
    setDeleteError("");

    try {
      await onDeleteRecipe(id);
      setRecipeToDelete(null);
      if (
        previousActiveElementRef.current &&
        typeof previousActiveElementRef.current.focus === "function"
      ) {
        setTimeout(() => {
          previousActiveElementRef.current?.focus();
        }, 50);
      }
    } catch (err) {
      setDeleteError(err.message || "Failed to delete recipe. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleScrollToStart = () => {
    const el = document.getElementById("step-01-heading") || document.querySelector(".recipe-card");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="cookbook" aria-labelledby="cookbook-heading">
      <div className="cookbook-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL COLLECTION</span>
          <h2 id="cookbook-heading">My Cookbook</h2>
          <p>Your AI-generated recipes, all in one place.</p>
        </div>

        <div className="cookbook-header-actions">
          {safeRecipes.length > 0 && (
            <button
              type="button"
              className={`favorite-button ${showFavoritesOnly ? "active" : ""}`}
              onClick={() => setShowFavoritesOnly((prev) => !prev)}
              aria-pressed={showFavoritesOnly}
            >
              <HeartIcon filled={showFavoritesOnly} />
              <span>{showFavoritesOnly ? "Show all recipes" : "Show favorites only"}</span>
            </button>
          )}

          <button
            type="button"
            className="analyze-button"
            onClick={onLoadRecipes}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load saved recipes"}
          </button>
        </div>
      </div>

      {error && <p className="cookbook-error" role="alert">{error}</p>}

      {/* Loading Skeletons */}
      {loading && (
        <div className="cookbook-grid" aria-label="Loading recipes">
          {[1, 2].map((n) => (
            <div key={n} className="cookbook-skeleton-card" aria-hidden="true">
              <div className="skeleton-bar skeleton-eyebrow" />
              <div className="skeleton-bar skeleton-title" />
              <div className="skeleton-bar skeleton-desc" />
              <div className="skeleton-bar skeleton-desc-short" />
              <div className="skeleton-meta-row">
                <div className="skeleton-bar skeleton-pill" />
                <div className="skeleton-bar skeleton-pill" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State: No recipes in collection */}
      {!loading && !error && safeRecipes.length === 0 && (
        <div className="cookbook-empty-card">
          <div className="cookbook-empty-icon" aria-hidden="true">📖</div>
          <h3>Your cookbook is empty</h3>
          <p>
            You haven't saved any recipes yet. Add your pantry ingredients in Step 01 above, personalize your preferences, and let ChefMind craft your first recipe!
          </p>
          <button
            type="button"
            className="cookbook-empty-cta-btn"
            onClick={handleScrollToStart}
          >
            <span>✳</span> Craft your first recipe →
          </button>
        </div>
      )}

      {/* Empty State: Filtered favorites empty */}
      {!loading && !error && showFavoritesOnly && displayedRecipes.length === 0 && safeRecipes.length > 0 && (
        <div className="cookbook-empty-card">
          <div className="cookbook-empty-icon" aria-hidden="true">🤍</div>
          <h3>No favorited recipes</h3>
          <p>
            You haven't bookmarked any favorites yet. Click the heart button on any saved recipe in your cookbook to add it here.
          </p>
          <button
            type="button"
            className="favorite-button"
            onClick={() => setShowFavoritesOnly(false)}
          >
            View all {safeRecipes.length} recipes
          </button>
        </div>
      )}

      {/* Recipe Grid */}
      {!loading && (
        <div className="cookbook-grid">
          {displayedRecipes.map((item) => {
            const ingredientsList = Array.isArray(item.ingredients)
              ? item.ingredients
              : typeof item.ingredients === "string"
                ? [item.ingredients]
                : [];

            const instructionsList = Array.isArray(item.instructions)
              ? item.instructions
              : typeof item.instructions === "string"
                ? [item.instructions]
                : [];

            return (
              <article className="cookbook-card" key={item._id}>
                <div className="cookbook-actions">
                  <button
                    type="button"
                    className={`favorite-button ${item.isFavorite ? "active" : ""}`}
                    onClick={() => onToggleFavorite(item._id)}
                    aria-label={
                      item.isFavorite
                        ? `Remove ${item.title} from favorites`
                        : `Add ${item.title} to favorites`
                    }
                  >
                    <HeartIcon filled={item.isFavorite} />
                    <span>{item.isFavorite ? "Favorited" : "Favorite"}</span>
                  </button>

                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => handleOpenDeleteModal(item)}
                    aria-label={`Delete ${item.title}`}
                  >
                    <TrashIcon />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="cookbook-card-eyebrow-row">
                  <span className="eyebrow">{item.meal || "YOUR RECIPE"}</span>
                  {item.language === "Hindi" && (
                    <span className="recipe-pill pill-language cookbook-language-pill">हिन्दी</span>
                  )}
                </div>

                <h3>{item.title}</h3>
                <p>{item.description}</p>

                <div className="cookbook-meta">
                  <span>⏱ {item.cookTime || "Time varies"}</span>
                  <span>🍽 {item.servings || 2} servings</span>
                  {item.difficulty && <span>⭐ {item.difficulty}</span>}
                  {item.spiceLevel && item.spiceLevel !== "No preference" && (
                    <span>🌶️ {item.spiceLevel}</span>
                  )}
                </div>

                {Array.isArray(item.dietaryNotes) && item.dietaryNotes.length > 0 && (
                  <div className="cookbook-tags-row">
                    {item.dietaryNotes.map((note, nIdx) => (
                      <span key={nIdx} className="recipe-pill pill-cuisine cookbook-dietary-pill">
                        {note}
                      </span>
                    ))}
                  </div>
                )}

                <details className="cookbook-details">
                  <summary className="cookbook-summary">
                    <span>View recipe details</span>
                    <span className="summary-chevron" aria-hidden="true">▾</span>
                  </summary>

                  <div className="cookbook-details-content">
                    {item.cookingInstructions && (
                      <div className="cookbook-custom-instructions-box">
                        <strong>Custom instructions:</strong> {item.cookingInstructions}
                      </div>
                    )}

                    <h4>Ingredients</h4>
                    <ul className="cookbook-ingredients-list">
                      {ingredientsList.map((ingredient, index) => {
                        let display = "";
                        if (typeof ingredient === "string") {
                          display = ingredient;
                        } else if (typeof ingredient === "object" && ingredient !== null) {
                          const qty =
                            ingredient.quantity !== null && ingredient.quantity !== undefined
                              ? `${ingredient.quantity} `
                              : "";
                          const unit = ingredient.unit ? `${ingredient.unit} ` : "";
                          const name = ingredient.name || "";
                          const opt = ingredient.optional ? " (Optional)" : "";
                          display = `${qty}${unit}${name}${opt}`.trim();
                        }
                        return <li key={index}>{display || "Ingredient"}</li>;
                      })}
                    </ul>

                    <h4>Instructions</h4>
                    <ol className="cookbook-instructions-list">
                      {instructionsList.map((step, index) => {
                        let text = "";
                        if (typeof step === "string") {
                          text = step;
                        } else if (typeof step === "object" && step !== null) {
                          const title = step.title ? `${step.title}: ` : "";
                          const desc = step.description || "";
                          text = `${title}${desc}`.trim();
                        }
                        return <li key={index}>{text || "Step instructions"}</li>;
                      })}
                    </ol>

                    {Array.isArray(item.substitutions) && item.substitutions.length > 0 && (
                      <>
                        <h4 className="cookbook-substitutions-heading">Substitutions</h4>
                        <ul className="cookbook-substitutions-list">
                          {item.substitutions.map((sub, sIdx) => (
                            <li key={sIdx}>
                              <strong>{sub.original}</strong> ➔ {sub.replacement} ({sub.ratio || "1:1"})
                              {sub.notes ? ` — ${sub.notes}` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}

      {/* Accessible Custom Deletion Modal with Focus Trapping & Error Feedback */}
      {recipeToDelete && (
        <div
          className="cookbook-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          onClick={handleCloseDeleteModal}
        >
          <div
            ref={deleteModalRef}
            className="cookbook-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cookbook-modal-header">
              <span className="cookbook-modal-icon" aria-hidden="true">🗑️</span>
              <h3 id="delete-dialog-title">Delete this recipe?</h3>
            </div>

            <p className="cookbook-modal-text">
              Are you sure you want to delete <strong>&ldquo;{recipeToDelete.title}&rdquo;</strong> from your saved collection? This action cannot be undone.
            </p>

            {deleteError && (
              <p className="cookbook-modal-error" role="alert">
                ⚠️ {deleteError}
              </p>
            )}

            <div className="cookbook-modal-actions">
              <button
                ref={cancelBtnRef}
                type="button"
                className="cookbook-modal-cancel-btn"
                onClick={handleCloseDeleteModal}
                disabled={Boolean(deletingId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cookbook-modal-confirm-btn"
                onClick={handleConfirmDelete}
                disabled={Boolean(deletingId)}
              >
                <TrashIcon />
                <span>{deletingId ? "Deleting..." : "Yes, delete recipe"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Cookbook;

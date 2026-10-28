import { useState } from "react";

/**
 * IngredientConfirmation Component (Step 02)
 *
 * Provides an interactive, editable confirmation interface between
 * ingredient input (text, voice, image recognition) and recipe generation.
 *
 * Allows users to:
 * - View all detected or entered ingredients clearly
 * - Edit ingredient names inline
 * - Remove individual ingredients
 * - Add missing ingredients with duplicate and whitespace validation
 * - Review and confirm or dismiss AI-uncertain items before adding them
 * - Confirm the final ingredient list to unlock recipe generation
 * - Return back to Step 01 editor if needed
 */
function IngredientConfirmation({
  items = [],
  onItemsChange,
  uncertainItems = [],
  onUncertainItemsChange,
  isConfirmed = false,
  onConfirm,
  onUnlock,
  onBackToEdit,
  observations = "",
  disabled = false,
}) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [editError, setEditError] = useState("");

  const [newIngredientText, setNewIngredientText] = useState("");
  const [addError, setAddError] = useState("");

  const [editingUncertainIdx, setEditingUncertainIdx] = useState(null);
  const [editingUncertainText, setEditingUncertainText] = useState("");

  // Normalize whitespace: trim and collapse multiple internal spaces
  function normalizeText(text) {
    if (!text || typeof text !== "string") return "";
    return text.trim().replace(/\s+/g, " ");
  }

  // --- Add new ingredient ---
  function handleAddIngredient() {
    const clean = normalizeText(newIngredientText);
    if (!clean) {
      setAddError("Please enter an ingredient name.");
      return;
    }

    // Check duplicate (case-insensitive exact match)
    const isDuplicate = items.some(
      (item) => item.toLowerCase() === clean.toLowerCase()
    );
    if (isDuplicate) {
      setAddError(`"${clean}" is already in your ingredient list.`);
      return;
    }

    onItemsChange([...items, clean]);
    setNewIngredientText("");
    setAddError("");
  }

  function handleAddKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddIngredient();
    }
  }

  // --- Inline edit ingredient ---
  function handleStartEdit(index, currentText) {
    setEditingIndex(index);
    setEditingText(currentText);
    setEditError("");
  }

  function handleSaveEdit(index) {
    const clean = normalizeText(editingText);
    if (!clean) {
      setEditError("Ingredient name cannot be empty.");
      return;
    }

    // Check duplicate among other items
    const isDuplicate = items.some(
      (item, i) => i !== index && item.toLowerCase() === clean.toLowerCase()
    );
    if (isDuplicate) {
      setEditError(`"${clean}" is already in your ingredient list.`);
      return;
    }

    const updated = [...items];
    updated[index] = clean;
    onItemsChange(updated);
    setEditingIndex(null);
    setEditingText("");
    setEditError("");
  }

  function handleCancelEdit() {
    setEditingIndex(null);
    setEditingText("");
    setEditError("");
  }

  function handleEditKeyDown(event, index) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveEdit(index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleCancelEdit();
    }
  }

  // --- Remove ingredient ---
  function handleRemoveItem(index) {
    if (editingIndex === index) {
      handleCancelEdit();
    }
    const updated = items.filter((_, i) => i !== index);
    onItemsChange(updated);
  }

  // --- Uncertain item handling ---
  function handleQuickAddUncertain(uIdx, text) {
    // Extract base name if parenthetical notes exist: "Yellow lentils (unclear...)" -> "Yellow lentils"
    const baseName = normalizeText(text.split("(")[0]) || normalizeText(text);
    if (!baseName) return;

    // Add to items if not duplicate
    const isDuplicate = items.some(
      (item) => item.toLowerCase() === baseName.toLowerCase()
    );
    if (!isDuplicate) {
      onItemsChange([...items, baseName]);
    }

    // Remove from uncertain items
    onUncertainItemsChange(uncertainItems.filter((_, i) => i !== uIdx));
  }

  function handleStartEditUncertain(uIdx, currentText) {
    const baseName = normalizeText(currentText.split("(")[0]) || normalizeText(currentText);
    setEditingUncertainIdx(uIdx);
    setEditingUncertainText(baseName);
  }

  function handleSaveAndAddUncertain(uIdx) {
    const clean = normalizeText(editingUncertainText);
    if (!clean) return;

    const isDuplicate = items.some(
      (item) => item.toLowerCase() === clean.toLowerCase()
    );
    if (!isDuplicate) {
      onItemsChange([...items, clean]);
    }

    setEditingUncertainIdx(null);
    setEditingUncertainText("");
    onUncertainItemsChange(uncertainItems.filter((_, i) => i !== uIdx));
  }

  function handleDismissUncertain(uIdx) {
    if (editingUncertainIdx === uIdx) {
      setEditingUncertainIdx(null);
      setEditingUncertainText("");
    }
    onUncertainItemsChange(uncertainItems.filter((_, i) => i !== uIdx));
  }

  return (
    <section className="section confirmation-section" id="ingredient-confirmation-step">
      <div className="section-heading">
        <span className="step-number">02</span>
        <div>
          <h2>Review & confirm ingredients</h2>
          <p>Fine-tune and verify your ingredients before creating your recipe.</p>
        </div>
      </div>

      <div className="confirmation-card">
        {/* Header & Status Bar */}
        <div className="confirmation-header">
          <div className="confirmation-header-titles">
            <strong>Ingredient Review</strong>
            <span className="confirmation-subtitle">
              {items.length === 0
                ? "No ingredients added yet"
                : `${items.length} ingredient${items.length !== 1 ? "s" : ""} in list`}
            </span>
          </div>

          <div className="confirmation-badges">
            {isConfirmed ? (
              <span className="confirmation-status-badge confirmed">
                ✓ Confirmed ({items.length})
              </span>
            ) : (
              <span className="confirmation-status-badge pending">
                Pending confirmation
              </span>
            )}
          </div>
        </div>

        {/* Observations banner from AI image recognition */}
        {observations && (
          <div className="analysis-observations">
            <span className="observation-label">AI Visual Summary:</span>
            <p>{observations}</p>
          </div>
        )}

        {/* Section B: Uncertain items needing confirmation */}
        {uncertainItems.length > 0 && (
          <div className="uncertain-ingredients-block">
            <div className="uncertain-block-header">
              <div className="block-title warning">
                <span className="block-icon">⚠</span>
                <strong>Needs confirmation ({uncertainItems.length})</strong>
              </div>
              <p className="uncertain-description">
                The AI is unsure about these items. You can edit the name before adding, add directly, or dismiss:
              </p>
            </div>

            <div className="uncertain-list">
              {uncertainItems.map((suggestion, uIdx) => {
                const isEditingThis = editingUncertainIdx === uIdx;

                return (
                  <div key={uIdx} className="uncertain-card">
                    {isEditingThis ? (
                      <div className="uncertain-edit-form">
                        <input
                          type="text"
                          className="inline-edit-input"
                          value={editingUncertainText}
                          onChange={(e) => setEditingUncertainText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveAndAddUncertain(uIdx);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingUncertainIdx(null);
                            }
                          }}
                          placeholder="Edit ingredient name..."
                          autoFocus
                          aria-label="Edit uncertain item name"
                        />
                        <button
                          type="button"
                          className="uncertain-add-btn"
                          onClick={() => handleSaveAndAddUncertain(uIdx)}
                          title="Save and add to ingredients"
                        >
                          ✓ Add
                        </button>
                        <button
                          type="button"
                          className="uncertain-dismiss-btn"
                          onClick={() => setEditingUncertainIdx(null)}
                          title="Cancel editing"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="uncertain-card-text">{suggestion}</span>
                        <div className="uncertain-card-actions">
                          <button
                            type="button"
                            className="uncertain-edit-link"
                            onClick={() => handleStartEditUncertain(uIdx, suggestion)}
                            title="Edit name before adding"
                          >
                            ✎ Edit
                          </button>
                          <button
                            type="button"
                            className="uncertain-add-btn"
                            onClick={() => handleQuickAddUncertain(uIdx, suggestion)}
                            title="Add this item to confirmed ingredients"
                          >
                            + Add
                          </button>
                          <button
                            type="button"
                            className="uncertain-dismiss-btn"
                            onClick={() => handleDismissUncertain(uIdx)}
                            title="Dismiss suggestion"
                            aria-label={`Dismiss ${suggestion}`}
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section A: Main Confirmed / User-Edited Ingredients List */}
        <div className="confirmed-list-container">
          <div className="list-heading-row">
            <strong>Your ingredients ({items.length})</strong>
            <span className="list-hint">Click ✎ to edit or ✕ to remove</span>
          </div>

          {items.length === 0 ? (
            <div className="empty-list-card">
              <span className="empty-list-icon">∅</span>
              <p>No ingredients in the list yet.</p>
              <span className="empty-list-sub">
                Type ingredients above, record voice, upload photos, or add items below.
              </span>
            </div>
          ) : (
            <div className="ingredients-grid-list">
              {items.map((item, idx) => {
                const isEditing = editingIndex === idx;

                if (isEditing) {
                  return (
                    <div key={idx} className="ingredient-chip-edit-card">
                      <input
                        type="text"
                        className="inline-edit-input"
                        value={editingText}
                        onChange={(e) => {
                          setEditingText(e.target.value);
                          setEditError("");
                        }}
                        onKeyDown={(e) => handleEditKeyDown(e, idx)}
                        autoFocus
                        aria-label={`Editing ingredient ${item}`}
                      />
                      <div className="edit-card-actions">
                        <button
                          type="button"
                          className="inline-save-btn"
                          onClick={() => handleSaveEdit(idx)}
                          title="Save change (Enter)"
                        >
                          ✓ Save
                        </button>
                        <button
                          type="button"
                          className="inline-cancel-btn"
                          onClick={handleCancelEdit}
                          title="Cancel edit (Escape)"
                        >
                          ✕ Cancel
                        </button>
                      </div>
                      {editError && <span className="inline-edit-error">{editError}</span>}
                    </div>
                  );
                }

                return (
                  <div key={idx} className="ingredient-chip-row">
                    <span className="ingredient-chip-name" title={item}>
                      {item}
                    </span>
                    <div className="chip-buttons">
                      <button
                        type="button"
                        className="chip-btn edit"
                        onClick={() => handleStartEdit(idx, item)}
                        title={`Edit ${item}`}
                        aria-label={`Edit ${item}`}
                        disabled={disabled}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="chip-btn remove"
                        onClick={() => handleRemoveItem(idx)}
                        title={`Remove ${item}`}
                        aria-label={`Remove ${item}`}
                        disabled={disabled}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add missing ingredient input */}
          <div className="add-ingredient-box">
            <div className="add-ingredient-row">
              <input
                type="text"
                className="add-ingredient-input"
                placeholder="Add missing ingredient (e.g. 2 onions, 200 g paneer, cumin)..."
                value={newIngredientText}
                onChange={(e) => {
                  setNewIngredientText(e.target.value);
                  setAddError("");
                }}
                onKeyDown={handleAddKeyDown}
                disabled={disabled}
                aria-label="Add new ingredient"
              />
              <button
                type="button"
                className="add-ingredient-btn"
                onClick={handleAddIngredient}
                disabled={disabled || !newIngredientText.trim()}
              >
                + Add ingredient
              </button>
            </div>
            {addError && <p className="add-item-error">{addError}</p>}
          </div>
        </div>

        {/* Confirmation & Navigation Actions */}
        <div className="confirmation-actions-bar">
          <div className="action-buttons-group">
            <button
              type="button"
              className={`confirm-action-btn ${isConfirmed ? "confirmed" : ""}`}
              onClick={() => onConfirm(items)}
              disabled={items.length === 0 || disabled}
            >
              {isConfirmed ? (
                <>✓ Ingredients confirmed ({items.length})</>
              ) : (
                <>Confirm ingredients ({items.length}) →</>
              )}
            </button>

            {isConfirmed && (
              <button
                type="button"
                className="modify-action-btn"
                onClick={onUnlock}
                disabled={disabled}
                title="Unlock to make adjustments to your ingredient list"
              >
                ✎ Modify list
              </button>
            )}

            <button
              type="button"
              className="back-action-btn"
              onClick={onBackToEdit}
              title="Return to Step 01 to add photos or re-type"
            >
              ← Back to Step 01
            </button>
          </div>

          <div className="action-guidance-note">
            {isConfirmed ? (
              <span className="guidance-confirmed">
                ✓ Ready! Personalize preferences in <strong>Step 03</strong> below, then click &ldquo;Find my recipes&rdquo;.
              </span>
            ) : items.length > 0 ? (
              <span className="guidance-pending">
                Please click <strong>&ldquo;Confirm ingredients&rdquo;</strong> to proceed to recipe generation.
              </span>
            ) : (
              <span className="guidance-empty">
                Add at least one ingredient to confirm your list.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default IngredientConfirmation;

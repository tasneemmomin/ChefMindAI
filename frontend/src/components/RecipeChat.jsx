import { useState, useRef, useEffect } from "react";
import { sendRecipeChatMessage } from "../services/recipeService";

const SUGGESTED_PROMPTS = [
  "Make it less spicy 🌶️",
  "Can I replace paneer with tofu? 🔄",
  "Explain step 2 in more detail 👨‍🍳",
  "How can I prepare this in advance? ⏱️",
  "I don't have tomatoes, what can I use? 🍅",
];

let messageSequence = 0;
function createMessageId() {
  messageSequence += 1;
  return `msg_${messageSequence}_${Date.now()}`;
}

function getFormattedTimestamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function RecipeChat({ recipe, onApplyRecipeUpdate, onSaveCustomRecipe, authToken }) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [appliedUpdates, setAppliedUpdates] = useState(new Set());
  const [savedRecipes, setSavedRecipes] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom of chat when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSendMessage = async (textToSend) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || loading) return;

    if (text.length > 500) {
      setError("Message cannot exceed 500 characters.");
      return;
    }

    setError("");
    const userMsg = {
      id: createMessageId(),
      role: "user",
      content: text,
      timestamp: getFormattedTimestamp(),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInputMessage("");
    setLoading(true);

    try {
      // Build bounded history payload
      const historyPayload = newHistory.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await sendRecipeChatMessage(
        {
          recipeId: recipe?._id || null,
          recipe,
          message: text,
          history: historyPayload,
        },
        authToken
      );

      const assistantMsg = {
        id: createMessageId(),
        role: "assistant",
        type: res.type || "answer",
        content: res.message || "Here is my advice on this recipe.",
        changes: res.changes || [],
        updatedRecipe: res.updatedRecipe || null,
        timestamp: getFormattedTimestamp(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error("Recipe chat failed:", err);
      setError(err.message || "Failed to communicate with cooking assistant.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApplyUpdate = (msgId, updatedRecipe) => {
    if (!updatedRecipe || !onApplyRecipeUpdate) return;
    onApplyRecipeUpdate(updatedRecipe);
    setAppliedUpdates((prev) => new Set(prev).add(msgId));
  };

  const handleDismissUpdate = (msgId) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, dismissed: true } : m
      )
    );
  };

  const handleSaveToCookbook = async (msgId, updatedRecipe) => {
    if (!updatedRecipe || !onSaveCustomRecipe || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveCustomRecipe(updatedRecipe);
      setSavedRecipes((prev) => new Set(prev).add(msgId));
    } catch (err) {
      console.error("Save custom recipe failed:", err);
      setError("Failed to save recipe to cookbook. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setError("");
    setAppliedUpdates(new Set());
    setSavedRecipes(new Set());
  };

  if (!recipe) {
    return null;
  }

  return (
    <section className="recipe-chat-panel" aria-labelledby="chat-panel-heading">
      <div className="chat-panel-header">
        <div className="chat-header-title-block">
          <span className="chat-header-icon">👨‍🍳</span>
          <div>
            <h3 id="chat-panel-heading">Conversational Cooking Assistant</h3>
            <span className="chat-context-sub">
              Live culinary assistant for <strong>{recipe.title}</strong>
            </span>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            className="chat-clear-btn"
            onClick={handleClearChat}
            title="Start a fresh conversation"
          >
            Start new chat
          </button>
        )}
      </div>

      {/* Suggested prompts for quick inspiration */}
      {messages.length === 0 && (
        <div className="chat-suggestions-container">
          <span className="suggestions-label">Try asking:</span>
          <div className="suggestions-pills">
            {SUGGESTED_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                className="suggestion-pill"
                onClick={() => handleSendMessage(prompt)}
                disabled={loading}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages stream */}
      <div className="chat-messages-stream" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <p>
              Have questions about seasonings, prep steps, or want to tweak this dish? Ask ChefMind anything about this recipe!
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isApplied = appliedUpdates.has(msg.id);
          const isSaved = savedRecipes.has(msg.id);

          return (
            <div
              key={msg.id}
              className={`chat-bubble-row ${isUser ? "row-user" : "row-assistant"}`}
            >
              <div className={`chat-bubble ${isUser ? "bubble-user" : "bubble-assistant"}`}>
                <div className="bubble-header">
                  <span className="bubble-sender">{isUser ? "You" : "ChefMind AI"}</span>
                  <span className="bubble-time">{msg.timestamp}</span>
                </div>

                <div className="bubble-content">
                  <p>{msg.content}</p>

                  {/* Proposed recipe modification block */}
                  {msg.type === "recipe_update" && msg.updatedRecipe && !msg.dismissed && (
                    <div className="proposed-update-card">
                      <div className="update-card-header">
                        <span className="update-icon">📝</span>
                        <strong>Proposed Recipe Modification</strong>
                      </div>

                      {Array.isArray(msg.changes) && msg.changes.length > 0 && (
                        <ul className="update-changes-list">
                          {msg.changes.map((change, cIdx) => (
                            <li key={cIdx}>
                              <span className="change-field-tag">[{change.field || "recipe"}]</span>{" "}
                              {change.description}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="update-actions-row">
                        {!isApplied ? (
                          <>
                            <button
                              type="button"
                              className="update-apply-btn"
                              onClick={() => handleApplyUpdate(msg.id, msg.updatedRecipe)}
                            >
                              ✓ Apply changes to recipe
                            </button>
                            <button
                              type="button"
                              className="update-dismiss-btn"
                              onClick={() => handleDismissUpdate(msg.id)}
                            >
                              ✕ Dismiss
                            </button>
                          </>
                        ) : (
                          <div className="update-applied-status">
                            <span className="applied-pill">✓ Changes applied to current recipe</span>
                            <button
                              type="button"
                              className="save-custom-recipe-btn"
                              onClick={() => handleSaveToCookbook(msg.id, msg.updatedRecipe)}
                              disabled={isSaving || isSaved}
                            >
                              {isSaved ? "💾 Saved to Cookbook" : isSaving ? "Saving..." : "💾 Save as new in Cookbook"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {msg.dismissed && (
                    <div className="update-dismissed-note">
                      <span>✕ Modification proposal dismissed.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Loading state indicator */}
        {loading && (
          <div className="chat-bubble-row row-assistant">
            <div className="chat-bubble bubble-assistant bubble-loading">
              <div className="typing-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
              <span className="typing-label">ChefMind is thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="chat-error-bar" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      {/* Input area */}
      <form
        className="chat-input-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
      >
        <div className="chat-input-wrapper">
          <textarea
            className="chat-textarea"
            rows="1"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about substitutions, preparation steps, or recipe adjustments..."
            maxLength={500}
            disabled={loading}
            aria-label="Message to cooking assistant"
          />
          <div className="chat-input-actions">
            <span className="chat-char-counter">{inputMessage.length}/500</span>
            <button
              type="submit"
              className="chat-send-btn"
              disabled={loading || !inputMessage.trim()}
              aria-label="Send message"
            >
              {loading ? "..." : "Send"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

export default RecipeChat;

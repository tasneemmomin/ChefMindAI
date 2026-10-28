import { useState, useRef, useEffect } from "react";
import { analyzeIngredientImage } from "../services/ingredientService";
import CameraCaptureModal from "./CameraCaptureModal";

function IngredientSection({
  ingredients,
  setIngredients,
  inputMode,
  setInputMode,
  onError,
  authToken,
  onImageAnalysisSuccess,
  onReviewInput,
}) {
  const [images, setImages] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [imageAnalysis, setImageAnalysis] = useState(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const replaceTargetIdRef = useRef(null);
  const dragCounterRef = useRef(0);
  const imagesRef = useRef([]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const [isListening, setIsListening] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState("en-IN");
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef(null);

  const MAX_IMAGES = 5;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;        // 5 MB per image
  const MAX_COMBINED_SIZE = 15 * 1024 * 1024;   // 15 MB combined
  const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

  // Cleanup all active object URLs and voice recognition on component unmount
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function validateSingleFile(file) {
    if (!file) {
      return { valid: false, error: "No image file was selected." };
    }

    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `'${file.name}' exceeds the 5 MB limit.`,
      };
    }

    const isMimeValid = ALLOWED_MIME_TYPES.includes(file.type);
    const isExtValid = ALLOWED_EXTENSIONS.test(file.name);

    if (!isMimeValid && !isExtValid) {
      return {
        valid: false,
        error: `'${file.name}' is not supported. Please select a JPG, PNG, or WebP image.`,
      };
    }

    return { valid: true };
  }

  function handleAddFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    const currentImages = [...images];
    const availableSlots = MAX_IMAGES - currentImages.length;

    if (availableSlots <= 0) {
      onError(`Maximum upload limit reached (${MAX_IMAGES} photos max).`);
      return;
    }

    let currentTotalBytes = currentImages.reduce((sum, item) => sum + item.file.size, 0);
    const filesToAdd = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];

      const validation = validateSingleFile(file);
      if (!validation.valid) {
        onError(validation.error);
        return;
      }

      // Prevent duplicate selection: check name, size, lastModified
      const isDuplicate = currentImages.some(
        (existing) =>
          existing.file.name === file.name &&
          existing.file.size === file.size &&
          existing.file.lastModified === file.lastModified
      ) || filesToAdd.some(
        (staged) =>
          staged.name === file.name &&
          staged.size === file.size &&
          staged.lastModified === file.lastModified
      );

      if (isDuplicate) {
        continue;
      }

      if (filesToAdd.length >= availableSlots) {
        onError(`Upload limit reached. You can only select up to ${MAX_IMAGES} photos.`);
        break;
      }

      if (currentTotalBytes + file.size > MAX_COMBINED_SIZE) {
        onError("Combined upload size cannot exceed 15 MB.");
        return;
      }

      currentTotalBytes += file.size;
      filesToAdd.push(file);
    }

    if (filesToAdd.length === 0) {
      return;
    }

    const newItems = filesToAdd.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setImages((prev) => [...prev, ...newItems]);
    setImageAnalysis(null);
    onError("");
  }

  function handleFileInputChange(event) {
    const selectedFiles = event.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      handleAddFiles(Array.from(selectedFiles));
    }
    event.target.value = "";
  }

  function handlePhotoCaptured(capturedFile) {
    if (capturedFile) {
      handleAddFiles([capturedFile]);
    }
  }

  function triggerReplace(targetId) {
    replaceTargetIdRef.current = targetId;
    replaceInputRef.current?.click();
  }

  function handleReplaceInputChange(event) {
    const file = event.target.files?.[0];
    const targetId = replaceTargetIdRef.current;
    event.target.value = "";

    if (!file || !targetId) return;

    const validation = validateSingleFile(file);
    if (!validation.valid) {
      onError(validation.error);
      return;
    }

    setImages((prev) => {
      const targetItem = prev.find((item) => item.id === targetId);
      if (!targetItem) return prev;

      const otherBytes = prev
        .filter((item) => item.id !== targetId)
        .reduce((sum, item) => sum + item.file.size, 0);

      if (otherBytes + file.size > MAX_COMBINED_SIZE) {
        onError("Combined upload size cannot exceed 15 MB.");
        return prev;
      }

      URL.revokeObjectURL(targetItem.previewUrl);

      return prev.map((item) =>
        item.id === targetId
          ? {
              id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
              file,
              previewUrl: URL.createObjectURL(file),
            }
          : item
      );
    });

    setImageAnalysis(null);
    onError("");
  }

  function handleRemoveImage(targetId) {
    setImages((prev) => {
      const target = prev.find((item) => item.id === targetId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== targetId);
    });
    setImageAnalysis(null);
    onError("");
  }

  function handleClearAllImages() {
    images.forEach((item) => {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setImages([]);
    setImageAnalysis(null);
    onError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    if (event.dataTransfer?.items && event.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    if (!isDragging) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const droppedFiles = event.dataTransfer?.files;
    if (droppedFiles && droppedFiles.length > 0) {
      handleAddFiles(Array.from(droppedFiles));
    }
  }

  function handleDropzoneKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  async function handleAnalyzeImages() {
    if (images.length === 0) {
      onError("Please select at least one ingredient photo.");
      return;
    }

    setAnalyzingImage(true);
    onError("");
    setImageAnalysis(null);

    try {
      const rawFiles = images.map((item) => item.file);
      const data = await analyzeIngredientImage(rawFiles, authToken);
      setImageAnalysis(data);
      setIngredients(data.ingredients.join(", "));
      if (onImageAnalysisSuccess) {
        onImageAnalysisSuccess(data);
      }
      const confirmStep = document.getElementById("ingredient-confirmation-step");
      if (confirmStep) {
        confirmStep.scrollIntoView({ behavior: "smooth" });
      }
    } catch (err) {
      console.error("Image analysis failed:", err);
      onError(err.message || "Unable to analyze the images.");
    } finally {
      setAnalyzingImage(false);
    }
  }

  function handleReviewText() {
    if (!ingredients.trim()) {
      onError("Please enter at least one ingredient first.");
      return;
    }
    const parsed = ingredients
      .split(/,|\n/)
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    if (parsed.length === 0) {
      onError("Please enter at least one valid ingredient.");
      return;
    }

    if (onReviewInput) {
      onReviewInput(parsed, "text");
    }
    const confirmStep = document.getElementById("ingredient-confirmation-step");
    if (confirmStep) {
      confirmStep.scrollIntoView({ behavior: "smooth" });
    }
  }

  function handleReviewVoice() {
    if (!ingredients.trim()) {
      onError("Please record or enter your ingredients first.");
      return;
    }
    const parsed = ingredients
      .split(/,|\n/)
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    if (parsed.length === 0) {
      onError("Please enter at least one valid ingredient.");
      return;
    }

    if (onReviewInput) {
      onReviewInput(parsed, "voice");
    }
    const confirmStep = document.getElementById("ingredient-confirmation-step");
    if (confirmStep) {
      confirmStep.scrollIntoView({ behavior: "smooth" });
    }
  }

  function toggleVoiceRecognition() {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceSupported(false);
      onError(
        "Speech recognition is not supported in this browser. Try Chrome or enter your ingredients manually."
      );
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = voiceLanguage;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

      onError("");
      setIsListening(true);

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript + " ";
        }
        setIngredients(transcript.trim());
      };

      recognition.onerror = (event) => {
        if (event.error === "not-allowed") {
          onError("Microphone permission was denied. Please allow microphone access in your browser settings.");
        } else if (event.error === "no-speech") {
          onError("No speech was detected. Please try speaking again.");
        } else {
          onError(`Voice recognition error: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch {
      onError("Could not start microphone speech recognition.");
      setIsListening(false);
    }
  }

  return (
    <section className="section">
      <div className="section-heading">
        <span className="step-number">01</span>
        <div>
          <h2>What ingredients do you have?</h2>
          <p>Choose how you want to tell us.</p>
        </div>
      </div>

      <div className="input-tabs">
        {[
          { id: "text", icon: "✎", label: "Type ingredients" },
          { id: "image", icon: "▧", label: "Upload photo" },
          { id: "voice", icon: "♩", label: "Use voice" },
        ].map((option) => (
          <button
            key={option.id}
            type="button"
            className={`input-tab ${inputMode === option.id ? "active" : ""}`}
            onClick={() => {
              setInputMode(option.id);
              onError("");
            }}
          >
            <span>{option.icon}</span>
            {option.label}
          </button>
        ))}
      </div>

      {inputMode === "text" && (
        <div className="text-mode-wrapper">
          <textarea
            className="ingredients-input"
            placeholder="E.g. 2 onions, 200 g paneer, tomatoes, 1 tsp cumin..."
            value={ingredients}
            onChange={(event) => setIngredients(event.target.value)}
            rows={4}
          />
          <button
            type="button"
            className="review-input-nav-btn"
            onClick={handleReviewText}
            disabled={!ingredients.trim()}
          >
            Review ingredients →
          </button>
        </div>
      )}

      {inputMode === "image" && (
        <div className="image-upload-wrapper">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={handleFileInputChange}
            style={{ display: "none" }}
          />

          <input
            ref={replaceInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={handleReplaceInputChange}
            style={{ display: "none" }}
          />

          {images.length === 0 ? (
            <div
              className={`upload-area ${isDragging ? "drag-over" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="Drop your ingredient photos here or browse"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={handleDropzoneKeyDown}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <span className="upload-icon">↑</span>

              <strong>
                {isDragging
                  ? "Drop your images here!"
                  : "Drop your ingredient photos here (up to 5)"}
              </strong>

              <span>Drag & drop photos or choose how to add:</span>

              <div className="upload-options-row">
                <button
                  type="button"
                  className="upload-pill-btn upload-choose-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <span className="pill-btn-icon">📁</span>
                  <span>Choose images</span>
                </button>

                <button
                  type="button"
                  className="upload-pill-btn upload-camera-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsCameraOpen(true);
                  }}
                >
                  <span className="pill-btn-icon">📷</span>
                  <span>Take photo (real time)</span>
                </button>
              </div>

              <span className="upload-specs">
                Select up to 5 JPG, PNG, or WebP photos · Max 5 MB each · 15 MB combined
              </span>
            </div>
          ) : (
            <div className="gallery-container">
              <div className="gallery-header">
                <div className="gallery-info">
                  <strong>
                    Selected Photos ({images.length} of {MAX_IMAGES})
                  </strong>
                  <span className="gallery-stats">
                    {formatFileSize(
                      images.reduce((sum, item) => sum + item.file.size, 0)
                    )}{" "}
                    / 15 MB max
                  </span>
                </div>
                <div className="gallery-header-actions">
                  {images.length < MAX_IMAGES && (
                    <>
                      <button
                        type="button"
                        className="gallery-camera-btn"
                        onClick={() => setIsCameraOpen(true)}
                        disabled={analyzingImage}
                        title="Take photo in real time using camera"
                      >
                        📷 Take photo
                      </button>
                      <button
                        type="button"
                        className="gallery-add-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={analyzingImage}
                      >
                        + Add photo
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="gallery-clear-btn"
                    onClick={handleClearAllImages}
                    disabled={analyzingImage}
                  >
                    Clear all
                  </button>
                </div>
              </div>

              <div
                className={`images-gallery-grid ${isDragging ? "drag-over" : ""}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {images.map((item, index) => (
                  <div key={item.id} className="gallery-card">
                    <div className="gallery-thumbnail-wrapper">
                      <img
                        src={item.previewUrl}
                        alt={`Ingredient photo ${index + 1}`}
                        className="gallery-thumbnail-img"
                      />
                      <button
                        type="button"
                        className="gallery-remove-badge"
                        onClick={() => handleRemoveImage(item.id)}
                        disabled={analyzingImage}
                        aria-label={`Remove ${item.file.name}`}
                        title="Remove photo"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="gallery-card-details">
                      <span className="gallery-filename" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <div className="gallery-card-meta">
                        <span className="gallery-filesize">
                          {formatFileSize(item.file.size)}
                        </span>
                        <button
                          type="button"
                          className="gallery-replace-link"
                          onClick={() => triggerReplace(item.id)}
                          disabled={analyzingImage}
                        >
                          Replace
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {images.length < MAX_IMAGES && (
                  <>
                    <div
                      className={`gallery-add-card ${isDragging ? "drag-over" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label="Upload photo from files"
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={handleDropzoneKeyDown}
                    >
                      <span className="add-card-icon">+</span>
                      <span>Upload file</span>
                      <span className="add-card-limit">
                        {MAX_IMAGES - images.length} left
                      </span>
                    </div>

                    <div
                      className="gallery-add-card gallery-camera-add-card"
                      role="button"
                      tabIndex={0}
                      aria-label="Take photo with camera"
                      onClick={() => setIsCameraOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIsCameraOpen(true);
                        }
                      }}
                    >
                      <span className="add-card-icon">📷</span>
                      <span>Take photo</span>
                      <span className="add-card-limit">Live camera</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {images.length > 0 && (
            <button
              type="button"
              className="analyze-button"
              onClick={handleAnalyzeImages}
              disabled={analyzingImage}
            >
              {analyzingImage ? (
                <span className="loading-content">
                  <span className="button-spinner"></span>
                  Analyzing {images.length} photo{images.length > 1 ? "s" : ""} with Gemini AI...
                </span>
              ) : imageAnalysis ? (
                `Re-analyze ${images.length} photo${images.length > 1 ? "s" : ""} with AI`
              ) : (
                `Identify ingredients with AI (${images.length} photo${images.length > 1 ? "s" : ""})`
              )}
            </button>
          )}

          {imageAnalysis && (
            <div className="image-analysis-success-bar">
              <span className="success-icon">✓</span>
              <div className="analysis-success-info">
                <strong>Photos analyzed with AI ({images.length} photo{images.length > 1 ? "s" : ""})</strong>
                <p>
                  Found {imageAnalysis.ingredients?.length || 0} confident ingredients
                  {imageAnalysis.uncertainItems?.length ? ` and ${imageAnalysis.uncertainItems.length} uncertain item(s)` : ""}.
                </p>
              </div>
              <button
                type="button"
                className="scroll-to-step2-btn"
                onClick={() => {
                  const el = document.getElementById("ingredient-confirmation-step");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Review in Step 02 ↓
              </button>
            </div>
          )}
        </div>
      )}

      {inputMode === "voice" && (
        <div className="voice-placeholder">
          <span className="voice-icon">♫</span>

          <strong>Tell us what's in your kitchen</strong>

          <label className="field voice-language">
            <span>Recognition language</span>
            <select
              value={voiceLanguage}
              onChange={(event) => setVoiceLanguage(event.target.value)}
            >
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">Hindi</option>
            </select>
          </label>

          <button
            type="button"
            className="analyze-button"
            onClick={toggleVoiceRecognition}
          >
            {isListening ? "⏹ Stop listening" : "Start speaking"}
          </button>

          {!voiceSupported && (
            <p>Speech recognition isn't supported in this browser.</p>
          )}

          <label className="field voice-transcript">
            <span>Recognized ingredients — edit if needed</span>
            <textarea
              className="ingredients-input"
              value={ingredients}
              onChange={(event) => setIngredients(event.target.value)}
              placeholder="Your spoken ingredients will appear here..."
              rows={3}
            />
          </label>

          <button
            type="button"
            className="review-input-nav-btn"
            onClick={handleReviewVoice}
            disabled={!ingredients.trim()}
          >
            Review ingredients →
          </button>
        </div>
      )}

      {/* Real-time Camera Modal */}
      {isCameraOpen && (
        <CameraCaptureModal
          isOpen={isCameraOpen}
          onClose={() => setIsCameraOpen(false)}
          onPhotoCaptured={handlePhotoCaptured}
          maxPhotos={MAX_IMAGES}
          currentPhotoCount={images.length}
        />
      )}
    </section>
  );
}

export default IngredientSection;

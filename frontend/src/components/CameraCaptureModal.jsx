import { useState, useRef, useEffect, useCallback } from "react";

/**
 * Real-time Camera Capture Modal
 *
 * Provides a real-time live video stream from the user's camera (webcam or mobile camera).
 * Allows capturing snapshots directly into standard image File objects for ingredient recognition.
 * Includes camera switching (front/back), live preview, flash effect, and track cleanup.
 */
function CameraCaptureModal({
  isOpen,
  onClose,
  onPhotoCaptured,
  maxPhotos = 5,
  currentPhotoCount = 0,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraState, setCameraState] = useState("loading"); // "loading" | "active" | "error" | "preview"
  const [errorMessage, setErrorMessage] = useState("");
  const [facingMode, setFacingMode] = useState("environment"); // "environment" (rear) or "user" (front)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [capturedSnapshot, setCapturedSnapshot] = useState(null); // { file, previewUrl }
  const capturedSnapshotRef = useRef(null);
  const [photosAddedSession, setPhotosAddedSession] = useState(0);
  const [isShutterFlashing, setIsShutterFlashing] = useState(false);

  const modalContainerRef = useRef(null);
  const previousActiveElementRef = useRef(null);

  useEffect(() => {
    capturedSnapshotRef.current = capturedSnapshot;
  }, [capturedSnapshot]);

  const availableSlots = maxPhotos - currentPhotoCount;

  // Stop active video stream tracks
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Check if device has multiple video cameras
  const detectCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      setHasMultipleCameras(videoDevices.length > 1);
    } catch {
      setHasMultipleCameras(false);
    }
  }, []);

  const [retryCount, setRetryCount] = useState(0);

  const handleCloseModal = useCallback(() => {
    stopStream();
    if (capturedSnapshotRef.current?.previewUrl) {
      URL.revokeObjectURL(capturedSnapshotRef.current.previewUrl);
    }
    setCapturedSnapshot(null);
    onClose();

    // Restore focus to the element that triggered the modal
    if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
      setTimeout(() => {
        previousActiveElementRef.current?.focus();
      }, 50);
    }
  }, [stopStream, onClose]);

  // Capture active element on modal open, handle ESC, and trap Tab focus
  useEffect(() => {
    if (!isOpen) return;

    // Save triggering element
    previousActiveElementRef.current = document.activeElement;

    // Auto-focus initial element inside modal for seamless keyboard navigation
    setTimeout(() => {
      if (modalContainerRef.current) {
        const firstFocusable = modalContainerRef.current.querySelector('button:not([disabled])');
        firstFocusable?.focus();
      }
    }, 50);

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseModal();
        return;
      }

      if (e.key === "Tab" && modalContainerRef.current) {
        const focusableSelectors = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(modalContainerRef.current.querySelectorAll(focusableSelectors));
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleCloseModal]);

  // Handle open/close and camera stream subscription lifecycle
  useEffect(() => {
    if (!isOpen) {
      stopStream();
      return;
    }

    let isSubscribed = true;

    if (!navigator.mediaDevices?.getUserMedia) {
      Promise.resolve().then(() => {
        if (!isSubscribed) return;
        setCameraState("error");
        setErrorMessage("Live camera is not supported in this browser. Please use the file upload option.");
      });
      return () => {
        isSubscribed = false;
        stopStream();
      };
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
        },
        audio: false,
      })
      .catch((err) => {
        console.warn("FacingMode constraint failed, falling back to basic video:", err);
        return navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      })
      .then((stream) => {
        if (!isSubscribed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (!isSubscribed) return;
            videoRef.current?.play().catch((playErr) => {
              console.warn("Autoplay was prevented:", playErr);
            });
            setCameraState("active");
          };
        } else {
          setCameraState("active");
        }

        detectCameras();
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.error("Camera access failed:", err);
        setCameraState("error");

        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setErrorMessage("Camera permission was denied. Please allow camera access in your browser site permissions.");
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setErrorMessage("No camera device was detected on your device.");
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          setErrorMessage("Your camera is currently in use by another application or tab.");
        } else {
          setErrorMessage(err.message || "Unable to start real-time camera stream.");
        }
      });

    return () => {
      isSubscribed = false;
      stopStream();
      if (capturedSnapshotRef.current?.previewUrl) {
        URL.revokeObjectURL(capturedSnapshotRef.current.previewUrl);
      }
    };
  }, [isOpen, facingMode, retryCount, detectCameras, stopStream]);

  // Handle Esc key to close modal
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        handleCloseModal();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleCloseModal]);

  // Switch between front and rear cameras
  function handleToggleCameraFacing() {
    if (cameraState === "loading") return;
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
  }

  // Play a brief visual shutter flash
  function triggerShutterFlash() {
    setIsShutterFlashing(true);
    setTimeout(() => {
      setIsShutterFlashing(false);
    }, 240);
  }

  // Capture real-time photo snapshot from video element
  function handleCapturePhoto() {
    const video = videoRef.current;
    if (!video || cameraState !== "active") return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw video frame
    ctx.drawImage(video, 0, 0, width, height);

    triggerShutterFlash();

    // Convert to JPEG blob
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrorMessage("Failed to create snapshot image.");
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `ingredient-photo-${timestamp}.jpg`;
        const file = new File([blob], fileName, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });

        const previewUrl = URL.createObjectURL(blob);
        setCapturedSnapshot({ file, previewUrl });
        setCameraState("preview");
      },
      "image/jpeg",
      0.92
    );
  }

  // Confirm and save captured photo
  function handleKeepCapturedPhoto(andTakeAnother = false) {
    if (!capturedSnapshot?.file) return;

    onPhotoCaptured(capturedSnapshot.file);
    setPhotosAddedSession((prev) => prev + 1);

    if (capturedSnapshot.previewUrl) {
      URL.revokeObjectURL(capturedSnapshot.previewUrl);
    }
    setCapturedSnapshot(null);

    const newSlotsRemaining = availableSlots - 1;

    if (andTakeAnother && newSlotsRemaining > 0) {
      setCameraState("active");
    } else {
      handleCloseModal();
    }
  }

  // Discard preview and resume live camera
  function handleRetakePhoto() {
    if (capturedSnapshot?.previewUrl) {
      URL.revokeObjectURL(capturedSnapshot.previewUrl);
    }
    setCapturedSnapshot(null);
    setCameraState("active");
  }

  if (!isOpen) return null;

  return (
    <div
      className="camera-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Real-time camera photo capture"
      onClick={handleCloseModal}
    >
      <div
        ref={modalContainerRef}
        className="camera-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="camera-modal-header">
          <div className="camera-modal-title-group">
            <span className="camera-live-pulse-badge">
              <span className="pulse-dot"></span>
              LIVE CAMERA
            </span>
            <h3>Take Ingredient Photo</h3>
          </div>

          <div className="camera-modal-header-actions">
            <span className="camera-slot-counter">
              {currentPhotoCount + photosAddedSession} / {maxPhotos} photos
            </span>

            {hasMultipleCameras && cameraState === "active" && (
              <button
                type="button"
                className="camera-switch-btn"
                onClick={handleToggleCameraFacing}
                title={`Switch camera (currently ${facingMode === "environment" ? "back" : "front"})`}
                aria-label="Switch camera"
              >
                🔄 Flip camera
              </button>
            )}

            <button
              type="button"
              className="camera-close-btn"
              onClick={handleCloseModal}
              aria-label="Close camera"
              title="Close camera"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Viewfinder / Video Canvas Box */}
        <div className="camera-viewfinder-box">
          {/* Shutter flash overlay */}
          <div className={`camera-flash-layer ${isShutterFlashing ? "flashing" : ""}`} />

          {/* Loading state */}
          {cameraState === "loading" && (
            <div className="camera-status-overlay">
              <div className="camera-spinner"></div>
              <p>Starting real-time camera stream...</p>
              <span>Please allow camera permissions if prompted</span>
            </div>
          )}

          {/* Error state */}
          {cameraState === "error" && (
            <div className="camera-error-overlay">
              <span className="camera-error-icon">📷</span>
              <h4>Unable to access camera</h4>
              <p>{errorMessage}</p>
              <div className="camera-error-actions">
                <button
                  type="button"
                  className="camera-retry-btn"
                  onClick={() => {
                    setCameraState("loading");
                    setErrorMessage("");
                    setRetryCount((c) => c + 1);
                  }}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className="camera-cancel-btn"
                  onClick={handleCloseModal}
                >
                  Close & use file upload
                </button>
              </div>
            </div>
          )}

          {/* Live Video Element */}
          <video
            ref={videoRef}
            className={`camera-video-stream ${cameraState === "active" ? "visible" : "hidden"}`}
            autoPlay
            playsInline
            muted
          />

          {/* Target Reticle / Framing Guide Overlay */}
          {cameraState === "active" && (
            <div className="camera-framing-guide" aria-hidden="true">
              <div className="corner corner-tl"></div>
              <div className="corner corner-tr"></div>
              <div className="corner corner-bl"></div>
              <div className="corner corner-br"></div>
              <div className="framing-hint">Align your ingredients in the frame</div>
            </div>
          )}

          {/* Snapshot Preview State */}
          {cameraState === "preview" && capturedSnapshot && (
            <div className="camera-preview-overlay">
              <img
                src={capturedSnapshot.previewUrl}
                alt="Captured ingredient preview"
                className="camera-preview-img"
              />
              <div className="preview-indicator-badge">
                ✓ Photo captured
              </div>
            </div>
          )}

          {/* Hidden Canvas for Frame Capture */}
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        {/* Controls / Footer */}
        <div className="camera-modal-footer">
          {cameraState === "active" && (
            <div className="camera-controls-active">
              <div className="camera-side-action">
                {photosAddedSession > 0 && (
                  <span className="camera-session-badge">
                    {photosAddedSession} added this session
                  </span>
                )}
              </div>

              {/* Shutter Button */}
              <div className="camera-shutter-container">
                <button
                  type="button"
                  className="camera-shutter-button"
                  onClick={handleCapturePhoto}
                  disabled={availableSlots <= 0}
                  aria-label="Capture photo"
                  title="Snap photo"
                >
                  <span className="shutter-inner-circle"></span>
                </button>
                <span className="shutter-label">Tap to take photo</span>
              </div>

              <div className="camera-side-action">
                {photosAddedSession > 0 ? (
                  <button
                    type="button"
                    className="camera-done-btn"
                    onClick={handleCloseModal}
                  >
                    Done ({photosAddedSession})
                  </button>
                ) : (
                  <button
                    type="button"
                    className="camera-cancel-link"
                    onClick={handleCloseModal}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {cameraState === "preview" && (
            <div className="camera-controls-preview">
              <button
                type="button"
                className="camera-retake-btn"
                onClick={handleRetakePhoto}
              >
                ↺ Retake
              </button>

              {availableSlots > 1 ? (
                <button
                  type="button"
                  className="camera-keep-another-btn"
                  onClick={() => handleKeepCapturedPhoto(true)}
                >
                  + Keep & take another
                </button>
              ) : null}

              <button
                type="button"
                className="camera-accept-btn"
                onClick={() => handleKeepCapturedPhoto(false)}
              >
                ✓ Use this photo
              </button>
            </div>
          )}

          {cameraState !== "active" && cameraState !== "preview" && (
            <div className="camera-controls-idle">
              <button
                type="button"
                className="camera-cancel-link"
                onClick={handleCloseModal}
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CameraCaptureModal;

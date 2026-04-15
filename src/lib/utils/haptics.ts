"use client";

/**
 * Triggers device haptic feedback if supported by the browser.
 * Must be called in response to a user interaction (click, touch, etc.).
 */
export function triggerHaptic(type: "light" | "medium" | "heavy" | "success" | "error" = "light") {
  // Ensure we are in a browser environment and vibration is supported
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.vibrate) {
    return;
  }

  try {
    switch (type) {
      case "light":
        navigator.vibrate(10);
        break;
      case "medium":
        navigator.vibrate(20);
        break;
      case "heavy":
        navigator.vibrate(30);
        break;
      case "success":
        navigator.vibrate([10, 30, 20]);
        break;
      case "error":
        navigator.vibrate([20, 40, 20, 40, 30]);
        break;
    }
  } catch (error) {
    // Silently catch exceptions; many browsers block vibrate() outside of active interactions
    if (process.env.NODE_ENV === "development") {
      console.warn("Haptic feedback ignored by browser. Was it wrapped in a user gesture?", error);
    }
  }
}

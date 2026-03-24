export function triggerHaptic(type: "light" | "medium" | "heavy" | "success" | "error" = "light") {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;

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
  } catch {
    // Ignore error if vibration fails
  }
}

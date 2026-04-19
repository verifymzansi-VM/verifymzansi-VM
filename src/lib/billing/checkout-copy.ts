export function getFriendlyCheckoutError(
  status?: number,
  error?: string | null,
  planName?: string
): string {
  if (status === 401) {
    return "Sign in to continue to secure checkout.";
  }

  if (status === 403) {
    return error || "Please confirm your email address before starting checkout.";
  }

  if (status === 409) {
    return error || "You already have a payment in progress for this area.";
  }

  if (status === 503) {
    return error || "Secure checkout is temporarily unavailable. Please try again shortly.";
  }

  if (status === 429) {
    return error || "Too many checkout attempts. Please wait a moment and try again.";
  }

  if (error?.trim()) {
    return error;
  }

  if (planName?.trim()) {
    return `Could not start checkout for ${planName}. Please try again.`;
  }

  return "Could not start secure checkout. Please try again.";
}

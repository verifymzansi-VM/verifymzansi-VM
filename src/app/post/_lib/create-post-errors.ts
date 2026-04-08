export interface CreatePostErrorState {
  formError: string;
  fieldErrors: Record<string, string>;
}

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error.trim();
  }

  if (error instanceof Error) {
    return error.message.trim();
  }

  return "";
}

export function normalizeCreatePostRuntimeError(error: unknown, fallbackMessage: string): string {
  const message = normalizeErrorMessage(error);

  // Surface the dedicated preflight error directly.
  if (error && typeof error === "object" && "name" in error) {
    const namedError = error as { name: string };
    if (namedError.name === "UploadServiceUnreachableError") {
      return message || "Upload service is not reachable. Check your connection and try again.";
    }
  }

  if (!message) {
    return fallbackMessage;
  }

  if (
    /failed to get video upload url|failed to upload video|network error during upload|upload was aborted/i.test(
      message
    )
  ) {
    return "Video upload could not be completed. Check your connection and try again. You can remove the video and submit again.";
  }

  if (/failed to upload photos|failed to upload photo|upload failed/i.test(message)) {
    return "One or more files could not be uploaded. Check your connection and try again.";
  }

  if (/security check failed|csrf/i.test(message)) {
    return "Security check failed. Please refresh the page and try again.";
  }

  if (/unauthorized|session expired|auth/i.test(message)) {
    return "Your session has expired. Please sign in again and retry.";
  }

  if (/failed to fetch/i.test(message)) {
    return "We couldn't reach the upload service. Check your connection and try again.";
  }

  return message;
}

export function normalizeCreatePostError(
  payload: unknown,
  fallbackMessage: string
): CreatePostErrorState {
  const fieldErrors: Record<string, string> = {};

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    if (Array.isArray(record.issues)) {
      for (const issue of record.issues) {
        if (!issue || typeof issue !== "object") continue;
        const issueRecord = issue as Record<string, unknown>;
        const path = typeof issueRecord.path === "string" ? issueRecord.path : "";
        const message = typeof issueRecord.message === "string" ? issueRecord.message : "";
        if (path && message && !fieldErrors[path]) {
          fieldErrors[path] = message;
        }
      }
    }

    if (record.details && typeof record.details === "object" && !Array.isArray(record.details)) {
      for (const [key, value] of Object.entries(record.details as Record<string, unknown>)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
          fieldErrors[key] = value[0];
        } else if (typeof value === "string") {
          fieldErrors[key] = value;
        }
      }
    }

    const formError =
      (typeof record.reason === "string" && record.reason) ||
      (typeof record.details === "string" && record.details) ||
      (typeof record.error === "string" && record.error) ||
      fallbackMessage;

    return { formError, fieldErrors };
  }

  return { formError: fallbackMessage, fieldErrors };
}

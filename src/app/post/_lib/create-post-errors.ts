export interface CreatePostErrorState {
  formError: string;
  fieldErrors: Record<string, string>;
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

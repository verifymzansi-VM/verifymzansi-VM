type UploadResponse = {
  urls?: unknown;
  errors?: unknown;
  error?: unknown;
  message?: unknown;
  traceId?: unknown;
};

export function parseUploadResponse(payload: UploadResponse | null) {
  const urls = Array.isArray(payload?.urls)
    ? payload.urls.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const errors = Array.isArray(payload?.errors)
    ? payload.errors.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    : [];

  return { urls, errors };
}

export function getPayloadError(payload: UploadResponse | null): string | null {
  if (!payload || typeof payload.error !== "string" || payload.error.trim().length === 0) {
    if (typeof payload?.message !== "string" || payload.message.trim().length === 0) {
      return null;
    }

    return payload.message.trim();
  }

  return payload.error.trim();
}

export function getPayloadTraceId(
  payload: UploadResponse | null,
  response?: Response
): string | null {
  if (payload && typeof payload.traceId === "string" && payload.traceId.trim().length > 0) {
    return payload.traceId.trim();
  }

  if (response && typeof response.headers?.get === "function") {
    const traceId = response.headers.get("x-upload-trace-id");
    if (traceId && traceId.trim().length > 0) {
      return traceId.trim();
    }
  }

  return null;
}

export function appendTraceId(message: string, traceId: string | null): string {
  if (!traceId || message.includes(traceId)) {
    return message;
  }

  return `${message} (Trace: ${traceId})`;
}

export async function parseUploadJson(response: Response): Promise<UploadResponse | null> {
  try {
    return (await response.json()) as UploadResponse;
  } catch {
    return null;
  }
}

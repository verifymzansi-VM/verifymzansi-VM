export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

type TextRequest = Pick<Request, "text"> & Partial<Pick<Request, "body" | "headers">>;

/** Limit actual UTF-8 bytes, including requests without a Content-Length header. */
export async function readBoundedRequestText(
  request: TextRequest,
  maxBytes: number
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Invalid request body limit");
  }
  const contentLength = request.headers?.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await request.body?.cancel().catch(() => {});
    throw new RequestBodyTooLargeError();
  }

  // Text-only adapters are used by internal callers and test fixtures.
  if (request.body === undefined) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RequestBodyTooLargeError();
    return text;
  }
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

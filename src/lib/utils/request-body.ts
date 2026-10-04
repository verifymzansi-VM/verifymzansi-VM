export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}

type TextRequest = Pick<Request, "text"> & Partial<Pick<Request, "body" | "headers">>;

async function checkDeclaredBodySize(
  request: Partial<Pick<Request, "body" | "headers">>,
  maxBytes: number
): Promise<void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Invalid request body limit");
  }
  const contentLength = request.headers?.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await request.body?.cancel().catch(() => {});
    throw new RequestBodyTooLargeError();
  }
}

/** Bound the complete multipart stream before the parser can buffer it. */
export async function readBoundedRequestFormData(
  request: Pick<Request, "formData"> & Partial<Pick<Request, "body" | "headers">>,
  maxBytes: number
): Promise<FormData> {
  await checkDeclaredBodySize(request, maxBytes);
  // Internal adapters already have parsed data. Production Requests always expose body.
  if (request.body === undefined) {
    const form = await request.formData();
    let bytes = 0;
    const encoder = new TextEncoder();
    for (const [key, value] of form) {
      bytes += encoder.encode(key).byteLength;
      bytes += typeof value === "string" ? encoder.encode(value).byteLength : value.size;
      if (bytes > maxBytes) throw new RequestBodyTooLargeError();
    }
    return form;
  }
  const contentType = request.headers?.get("content-type") ?? "";
  if (
    !/^multipart\/form-data\s*;/i.test(contentType) ||
    !/(?:^|;)\s*boundary=(?:"[^"]+"|[^;\s]+)(?:\s*;|\s*$)/i.test(contentType)
  ) {
    await request.body?.cancel().catch(() => {});
    throw new TypeError("Invalid multipart content type");
  }
  let bytes = 0;
  let tooLarge = false;
  const body = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          tooLarge = true;
          throw new RequestBodyTooLargeError();
        }
        controller.enqueue(chunk);
      },
    })
  );
  try {
    return await new Response(body, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch (error) {
    // A parser can reject the content type before consuming the stream.
    await body?.cancel().catch(() => {});
    // Multipart parsers may wrap stream errors in a TypeError.
    if (tooLarge) throw new RequestBodyTooLargeError();
    throw error;
  }
}

/** Limit actual UTF-8 bytes, including requests without a Content-Length header. */
export async function readBoundedRequestText(
  request: TextRequest,
  maxBytes: number
): Promise<string> {
  await checkDeclaredBodySize(request, maxBytes);

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

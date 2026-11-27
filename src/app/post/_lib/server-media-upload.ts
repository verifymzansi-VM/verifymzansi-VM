import { withCsrfHeaders } from "@/lib/utils/csrf";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { xhrFetch, type UploadProgressHandler } from "@/lib/utils/xhr-upload";
import { mediaUploadTimeoutMs } from "@/lib/media/upload-policy";
import {
  appendTraceId,
  getPayloadError,
  getPayloadTraceId,
  parseUploadJson,
  parseUploadResponse,
} from "@/app/post/_lib/media-upload-response";
import { normalizeCreatePostRuntimeError } from "@/app/post/_lib/create-post-errors";
import type { UploadArea } from "@/types/enums";

export async function uploadMediaViaServer({
  files,
  area,
  expectedCount = files.length,
  fallbackMessage,
  preferPayloadError = false,
  timeoutMs,
  onProgress,
}: {
  files: File[];
  area: UploadArea;
  expectedCount?: number;
  fallbackMessage: string;
  preferPayloadError?: boolean;
  timeoutMs?: number;
  /** Percent of the request body sent (0-100); switches the request to XHR. */
  onProgress?: UploadProgressHandler;
}): Promise<string[]> {
  const uploadData = new FormData();
  uploadData.append("area", area);
  files.forEach((file) => uploadData.append("files", file));

  const response = await fetchWithRetry(
    "/api/media/upload",
    {
      method: "POST",
      headers: withCsrfHeaders(),
      body: uploadData,
    },
    undefined,
    timeoutMs ?? mediaUploadTimeoutMs(files.reduce((total, file) => total + file.size, 0)),
    onProgress ? (input, init) => xhrFetch(input, init, onProgress) : undefined
  );

  const payload = await parseUploadJson(response);
  const { urls, errors } = parseUploadResponse(payload);
  const uploadSucceeded = response.ok && errors.length === 0 && urls.length === expectedCount;

  if (!uploadSucceeded) {
    const traceId = getPayloadTraceId(payload, response);
    const payloadMessage = errors[0] ?? getPayloadError(payload);
    const message =
      preferPayloadError && payloadMessage
        ? normalizeCreatePostRuntimeError(new Error(payloadMessage), fallbackMessage)
        : fallbackMessage;
    throw new Error(appendTraceId(message, traceId));
  }

  return urls;
}

export async function uploadMediaFileViaServer({
  file,
  area,
  fallbackMessage,
  preferPayloadError,
  timeoutMs,
  onProgress,
}: {
  file: File;
  area: UploadArea;
  fallbackMessage: string;
  preferPayloadError?: boolean;
  timeoutMs?: number;
  onProgress?: UploadProgressHandler;
}): Promise<string> {
  const urls = await uploadMediaViaServer({
    files: [file],
    area,
    expectedCount: 1,
    fallbackMessage,
    preferPayloadError,
    timeoutMs,
    onProgress,
  });

  return urls[0] ?? "";
}

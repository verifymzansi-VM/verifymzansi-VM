/**
 * A fetch-shaped request over XMLHttpRequest, used only where the page shows
 * how much of an upload has been sent (fetch has no upload progress events).
 *
 * It fails like fetch so retry code treats both alike: a network failure
 * rejects with a TypeError, an aborted signal rejects with the signal's reason.
 */
export type UploadProgressHandler = (percent: number) => void;

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    try {
      headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    } catch {
      // A header the Headers class refuses is not needed by the caller.
    }
  }
  return headers;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export function xhrFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  onUploadProgress?: UploadProgressHandler
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    const xhr = new XMLHttpRequest();
    const url = input instanceof Request ? input.url : String(input);
    xhr.open(init.method ?? "GET", url);
    // Text: the callers read small JSON replies.
    xhr.responseType = "text";
    new Headers(init.headers).forEach((value, key) => xhr.setRequestHeader(key, value));

    const onAbort = () => xhr.abort();
    const settle = () => signal?.removeEventListener("abort", onAbort);

    xhr.upload.onprogress = (event) => {
      if (!onUploadProgress || !event.lengthComputable || event.total <= 0) return;
      onUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      settle();
      try {
        resolve(
          new Response(NULL_BODY_STATUSES.has(xhr.status) ? null : xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
          })
        );
      } catch {
        reject(new TypeError("Failed to fetch"));
      }
    };
    xhr.onerror = () => {
      settle();
      reject(new TypeError("Failed to fetch"));
    };
    xhr.onabort = () => {
      settle();
      reject(signal ? abortReason(signal) : new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
  });
}

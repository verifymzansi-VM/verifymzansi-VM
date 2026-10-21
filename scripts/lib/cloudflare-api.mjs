const API_BASE = "https://api.cloudflare.com/client/v4";

class CloudflareRequestError extends Error {}

export function cloudflareRequestErrorMessage(error) {
  return error instanceof CloudflareRequestError
    ? error.message
    : "Cloudflare operation failed; inspect configuration and provider availability.";
}

/**
 * A Cloudflare v4 API caller bound to one token. It returns the response's
 * `result` and reports status/error codes without echoing provider text or credentials.
 */
export function createCloudflareRequest(token, fetchImpl = fetch) {
  return async function cfRequest(method, path, body) {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      const codes = Array.isArray(data?.errors)
        ? data.errors
            .map((error) => String(error?.code ?? ""))
            .filter((code) => /^\d{1,10}$/.test(code))
            .slice(0, 10)
        : [];
      throw new CloudflareRequestError(
        `Cloudflare API request failed (HTTP ${response.status}${codes.length ? `; codes ${codes.join(", ")}` : ""}).`
      );
    }

    return data.result;
  };
}

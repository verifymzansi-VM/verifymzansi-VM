const API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * A Cloudflare v4 API caller bound to one token. It returns the response's
 * `result` and throws with Cloudflare's own error codes when a call fails.
 */
export function createCloudflareRequest(token) {
  return async function cfRequest(method, path, body) {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      const details =
        data?.errors?.map((error) => `${error.code}: ${error.message}`).join("; ") ||
        response.statusText;
      throw new Error(`${method} ${path} failed: ${details}`);
    }

    return data.result;
  };
}

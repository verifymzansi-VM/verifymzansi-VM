/** Workers supports follow/manual, but rejects redirect:error. Manual mode
 * plus an explicit refusal preserves the same credential boundary on Workers,
 * Node and browsers (where cross-origin manual redirects are opaque). */
export async function fetchWithoutRedirects(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: typeof fetch = globalThis.fetch
): Promise<Response> {
  const response = await fetcher(input, { ...init, redirect: "manual" });
  if ((response.status >= 300 && response.status < 400) || response.type === "opaqueredirect")
    throw new Error("Unexpected redirect refused");
  return response;
}

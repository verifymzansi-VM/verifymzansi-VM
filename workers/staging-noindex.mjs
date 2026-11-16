// The staging copy (M0.15b) is a public workers.dev address that must stay
// out of search results. On the staging Worker (ENVIRONMENT "staging") every
// response carries X-Robots-Tag; production responses are returned untouched.
export const STAGING_ROBOTS_TAG = "noindex, nofollow, noarchive";

export function markStagingResponse(response, env) {
  if (env?.ENVIRONMENT !== "staging") return response;
  // A WebSocket upgrade must be returned as it is.
  if (response.status === 101 || response.webSocket) return response;
  const marked = new Response(response.body, response);
  marked.headers.set("X-Robots-Tag", STAGING_ROBOTS_TAG);
  return marked;
}

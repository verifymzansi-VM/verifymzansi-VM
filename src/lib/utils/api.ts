/**
 * Safely parse a JSON request body, returning null if invalid
 * to prevent uncaught 500 errors on the server.
 */
export async function parseJsonRequest<T = Record<string, unknown>>(
  request: Request
): Promise<T | null> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

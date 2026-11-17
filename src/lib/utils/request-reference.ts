/**
 * Request references: the number a visitor can quote to support so staff can
 * find the matching server log line.
 *
 * On Cloudflare this is the request's Ray ID (the `cf-ray` header, for example
 * `8f1a2b3c4d5e6f70-JNB`). It identifies one request and holds no personal
 * data. Where no Ray ID exists (local development, tests) a random value of the
 * same shape is used, so a reply and its log line still match.
 */

const RAY_ID = /^[0-9a-f]{16}(?:-[A-Z]{3,4})?$/i;

/** Name of the Server-Timing entry that carries the reference to the browser. */
export const REFERENCE_TIMING_NAME = "cfray";

type HeaderSource = Pick<Headers, "get"> | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof (headers as Pick<Headers, "get">).get === "function")
    return (headers as Pick<Headers, "get">).get(name) ?? undefined;
  const value = (headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The Cloudflare Ray ID of this request, or null when absent or malformed. */
export function readRayId(headers: HeaderSource): string | null {
  const value = readHeader(headers, "cf-ray")?.trim();
  return value && RAY_ID.test(value) ? value : null;
}

function randomReference(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The reference for this request: its Ray ID, or a fresh random one. */
export function requestReference(headers: HeaderSource): string {
  return readRayId(headers) ?? randomReference();
}

/**
 * Passes the Ray ID to the browser as a Server-Timing entry, the one response
 * header page scripts can read (PerformanceResourceTiming.serverTiming). Error
 * pages show it as the reference. Nothing is added without a valid Ray ID.
 */
export function addReferenceTiming(
  request: { headers: Pick<Headers, "get"> },
  response: { headers: Pick<Headers, "append"> }
): void {
  const ray = readRayId(request.headers);
  if (ray) response.headers.append("Server-Timing", `${REFERENCE_TIMING_NAME};desc="${ray}"`);
}

/** True for values this module produces; anything else is never displayed. */
export function isRequestReference(value: unknown): value is string {
  return typeof value === "string" && RAY_ID.test(value);
}

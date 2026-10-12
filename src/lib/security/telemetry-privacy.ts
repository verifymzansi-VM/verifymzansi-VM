/** Sanitize telemetry copies only; application request/navigation URLs stay intact. */
export function telemetryUrl(value: string): string {
  return value.split(/[?#]/, 1)[0].replace(/^(https?:\/\/)[^/@]*@/i, "$1[redacted]@");
}

const PRIVATE_KEY =
  /^(?:user|cookies?|headers?|data|body|request_body|post_data|email|phone|address|dob|date_of_birth|id_number|password|authorization|token_hash|access_token|refresh_token|secret|api_key)$/i;
const URL_KEY =
  /^(?:url|urls|from|to|filename|transaction|url\.full|http\.url|http\.target|http\.referer|referer|referrer)$/i;
const QUERY_KEY = /^(?:query_string|query|fragment|(?:http|url)\.(?:query|fragment))$/i;

function sanitize(value: unknown, key: string, depth: number): unknown {
  if (depth > 20) return "[redacted]";
  if (QUERY_KEY.test(key)) return "[redacted]";
  // Breadcrumb data and span data are useful maps, whereas HTTP payloads are
  // not part of the telemetry contract. The request object is handled below.
  // Omit private structured SDK fields rather than changing their schema
  // (for example, Sentry user/headers must not become a scalar string).
  if (PRIVATE_KEY.test(key) && key !== "data") return undefined;
  if (typeof value === "string") {
    if (URL_KEY.test(key)) return telemetryUrl(value);
    // Errors and span descriptions may contain absolute/relative request URLs.
    return value.replace(/(?:https?:\/\/|\/)[^\s"'<>]+/g, telemetryUrl);
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => {
        if (key === "request" && /^(?:data|body|cookies|headers|query_string)$/i.test(name)) {
          return [name, undefined];
        }
        return [name, sanitize(entry, name, depth + 1)];
      })
    );
  }
  return value;
}

/** SDK events, transactions and breadcrumbs share this bounded JSON boundary. */
export function sanitizeTelemetry<T extends object>(value: T): T {
  return sanitize(value, "", 0) as T;
}

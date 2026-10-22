import "server-only";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";
import { createLogger } from "@/lib/utils/logger";

/**
 * Security events: one fixed record per sign-in, refusal or protection hit.
 *
 * Records never hold emails, phone numbers, names, codes, tokens, raw IP
 * addresses, request bodies or query strings. An IP, email or rate-limit key
 * becomes a keyed fingerprint (HMAC-SHA256 with SECURITY_LOG_HASH_KEY), so one
 * attacker can be followed across accounts without storing who they are; with
 * no key configured, fingerprints are left out. Each record goes to the Worker
 * log and, when the dedicated bucket and its own write token are configured, to
 * a private R2 bucket that keeps 30 days (lifecycle rule and bucket lock are
 * set on the bucket, not here).
 */

export const SECURITY_EVENTS = [
  "auth.sign_in.succeeded",
  "auth.sign_in.failed",
  "auth.sign_in.locked",
  "auth.sign_in.blocked",
  "request.origin_rejected",
  "request.csrf_rejected",
  "request.rate_limited",
  "request.captcha_failed",
  "request.permission_denied",
  "staff.second_factor_required",
  "payment.callback_rejected",
] as const;

export type SecurityEventName = (typeof SECURITY_EVENTS)[number];

export interface SecurityEventInput {
  event: SecurityEventName;
  accountId?: string | null;
  /** Raw values below are fingerprinted, never written. */
  ip?: string | null;
  email?: string | null;
  rateLimitKey?: string | null;
  country?: string | null;
  userAgent?: string | null;
  /** Request path; ids, numbers and the query string are removed. */
  route?: string | null;
  /** Short stable code, for example "invalid_credentials" or "auth:login". */
  reason?: string | null;
}

export interface SecurityEventRecord {
  v: 1;
  event: SecurityEventName;
  at: string;
  account_id?: string;
  ip_fp?: string;
  email_fp?: string;
  key_fp?: string;
  country?: string;
  client?: string;
  route?: string;
  reason?: string;
}

const log = createLogger("SecurityEvent");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_NAMES = new Set<string>(SECURITY_EVENTS);
const encoder = new TextEncoder();

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

let cachedKey: { raw: string; key: Promise<CryptoKey> } | null = null;

function fingerprintKey(): Promise<CryptoKey> | null {
  const raw = readEnv("SECURITY_LOG_HASH_KEY");
  if (!raw || raw.length < 32) return null;
  if (cachedKey?.raw !== raw) {
    cachedKey = {
      raw,
      key: crypto.subtle.importKey(
        "raw",
        encoder.encode(raw),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      ),
    };
  }
  return cachedKey.key;
}

async function fingerprint(
  key: Promise<CryptoKey> | null,
  kind: string,
  value: string | null | undefined
): Promise<string | undefined> {
  const normalized = value?.trim().toLowerCase();
  if (!key || !normalized || normalized === "unknown") return undefined;
  const mac = await crypto.subtle.sign("HMAC", await key, encoder.encode(kind + ":" + normalized));
  // 132-bit pseudonymous correlation value; still treat it as personal data.
  return Buffer.from(mac).toString("base64url").slice(0, 22);
}

export function clientFamily(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  const browser = /Edg\//.test(userAgent)
    ? "edge"
    : /SamsungBrowser\//.test(userAgent)
      ? "samsung"
      : /Firefox\//.test(userAgent)
        ? "firefox"
        : /Chrome\//.test(userAgent)
          ? "chrome"
          : /Safari\//.test(userAgent)
            ? "safari"
            : /curl|wget|python|go-http|okhttp|java/i.test(userAgent)
              ? "script"
              : "other";
  const system = /Android/.test(userAgent)
    ? "android"
    : /iPhone|iPad|iPod/.test(userAgent)
      ? "ios"
      : /Windows/.test(userAgent)
        ? "windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macos"
          : /Linux/.test(userAgent)
            ? "linux"
            : "other";
  return browser + "/" + system;
}

// Log route shapes, never arbitrary slugs, email addresses or reset tokens.
const ROUTE_SEGMENTS = new Set(
  (
    "api auth login register logout reset-password forgot-password change-password profile avatar " +
    "foundation organisations organisation partner partners commissions programmes showcases " +
    "posting-terms contacts inbox notifications enquiries verification admin business-verification " +
    "evidence files media upload posts post create edit delete billing payments webhooks ozow " +
    "otp send verify resend accept status read dismiss settings reports flags staff dashboard contact"
  ).split(" ")
);

export function sanitizeRoute(route: string | null | undefined): string | undefined {
  if (!route) return undefined;
  const path = route.split(/[?#]/, 1)[0] ?? "";
  const cleaned = path
    .split("/")
    .map((part) =>
      !part || ROUTE_SEGMENTS.has(part)
        ? part
        : UUID.test(part)
          ? ":id"
          : /^\d+$/.test(part)
            ? ":n"
            : ":segment"
    )
    .join("/")
    .slice(0, 120);
  return cleaned.startsWith("/") ? cleaned : undefined;
}

function sanitizeReason(reason: string | null | undefined): string | undefined {
  return reason && /^[a-z0-9_:.-]{1,60}$/i.test(reason) ? reason.toLowerCase() : undefined;
}

/** Builds the stored record from allowlisted, reduced fields only. */
export async function buildSecurityEvent(
  input: SecurityEventInput,
  now: Date = new Date()
): Promise<SecurityEventRecord> {
  if (!EVENT_NAMES.has(input.event)) throw new Error("Unknown security event");
  const key = fingerprintKey();
  const [ipFp, emailFp, keyFp] = await Promise.all([
    fingerprint(key, "ip", input.ip),
    fingerprint(key, "email", input.email),
    fingerprint(key, "key", input.rateLimitKey),
  ]);
  const record: SecurityEventRecord = { v: 1, event: input.event, at: now.toISOString() };
  if (input.accountId && UUID.test(input.accountId))
    record.account_id = input.accountId.toLowerCase();
  if (ipFp) record.ip_fp = ipFp;
  if (emailFp) record.email_fp = emailFp;
  if (keyFp) record.key_fp = keyFp;
  if (input.country && /^[A-Z]{2}$/.test(input.country)) record.country = input.country;
  const client = clientFamily(input.userAgent);
  if (client) record.client = client;
  const route = sanitizeRoute(input.route);
  if (route) record.route = route;
  const reason = sanitizeReason(input.reason);
  if (reason) record.reason = reason;
  return record;
}

/** Request-derived context: client IP, country, browser family and path. */
export function securityContext(request: {
  headers: Pick<Headers, "get">;
  url: string;
}): Pick<SecurityEventInput, "ip" | "country" | "userAgent" | "route"> {
  const header = (name: string) => request.headers.get(name)?.trim() || null;
  let route: string | null = null;
  try {
    route = new URL(request.url).pathname;
  } catch {
    route = null;
  }
  return {
    ip: header("cf-connecting-ip") ?? header("x-real-ip") ?? null,
    country: header("cf-ipcountry"),
    userAgent: header("user-agent"),
    route,
  };
}

let storeClient: { config: string; client: S3Client } | null = null;

function securityStore(): { client: S3Client; bucket: string } | null {
  const accountId = readEnv("R2_ACCOUNT_ID");
  const bucket = readEnv("SECURITY_LOG_BUCKET");
  const accessKeyId = readEnv("SECURITY_LOG_R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("SECURITY_LOG_R2_SECRET_ACCESS_KEY");
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  const config = JSON.stringify([accountId, accessKeyId, secretAccessKey]);
  if (storeClient?.config !== config) {
    storeClient = {
      config,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
    };
  }
  return { client: storeClient.client, bucket };
}

export function securityEventObjectKey(record: SecurityEventRecord): string {
  const at = record.at;
  const hour = at.slice(0, 13).replace("T", "/").replace(/-/g, "/");
  return `events/${hour}/${at.replace(/[:.]/g, "")}-${crypto.randomUUID()}.json`;
}

// Repeated rate-limit hits from one source are recorded once a minute per
// isolate, so a flood cannot exhaust the free storage operations.
const recentRateLimits = new Map<string, number>();

function suppressRepeat(record: SecurityEventRecord, now: number): boolean {
  if (record.event !== "request.rate_limited") return false;
  const signature = `${record.reason ?? ""}:${record.key_fp ?? record.ip_fp ?? ""}`;
  const last = recentRateLimits.get(signature);
  if (last !== undefined && now - last < 60_000) return true;
  if (recentRateLimits.size >= 2000) recentRateLimits.clear();
  recentRateLimits.set(signature, now);
  return false;
}

export async function writeSecurityEvent(input: SecurityEventInput): Promise<void> {
  const record = await buildSecurityEvent(input);
  if (suppressRepeat(record, Date.now())) return;
  log.info("security_event", { ...record });
  const store = securityStore();
  if (!store) return;
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: securityEventObjectKey(record),
      Body: JSON.stringify(record) + "\n",
      ContentType: "application/x-ndjson",
    }),
    { abortSignal: AbortSignal.timeout(5000) }
  );
}

/** Fire-and-forget: never delays or fails the request it describes. */
export function recordSecurityEvent(input: SecurityEventInput): void {
  scheduleBackgroundTask(writeSecurityEvent(input), "security event");
}

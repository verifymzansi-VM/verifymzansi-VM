import crypto from "crypto";
import { env } from "@/lib/config/env";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Ozow");

export class OzowConfigurationError extends Error {
  readonly code = "ozow_configuration_error" as const;

  constructor(
    message: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "OzowConfigurationError";
  }
}

export class OzowAuthenticationError extends Error {
  readonly code = "ozow_authentication_error" as const;

  constructor(
    message: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "OzowAuthenticationError";
  }
}

export class OzowProviderError extends Error {
  readonly code = "ozow_provider_error" as const;

  constructor(
    message: string,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "OzowProviderError";
  }
}

type CachedToken = {
  accessToken: string;
  expiresAt: number;
  scope: string;
};

const cachedTokens = new Map<string, CachedToken>();

const OZOW_ALLOWED_HOSTS = {
  production: new Set(["one.ozow.com"]),
  nonProduction: new Set(["stagingone.ozow.com", "one.ozow.com"]),
} as const;

function isAllowedOzowBaseUrl(url: URL, ozowEnv: "staging" | "production"): boolean {
  if (url.protocol !== "https:") {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const allowedHosts =
    ozowEnv === "production" ? OZOW_ALLOWED_HOSTS.production : OZOW_ALLOWED_HOSTS.nonProduction;
  return allowedHosts.has(host);
}

export function validateOzowBaseUrl(
  configuredBaseUrl: string,
  ozowEnv: "staging" | "production"
): string {
  let parsed: URL;
  try {
    parsed = new URL(configuredBaseUrl);
  } catch {
    throw new Error("OZOW_API_BASE_URL must be a valid URL");
  }

  if (!isAllowedOzowBaseUrl(parsed, ozowEnv)) {
    throw new Error(
      ozowEnv === "production"
        ? "OZOW_API_BASE_URL must use https://one.ozow.com in production"
        : "OZOW_API_BASE_URL must use an approved Ozow HTTPS host"
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function getOzowEnvironment(): "staging" | "production" {
  return env("OZOW_ENV") === "production" ? "production" : "staging";
}

function getOzowBaseUrlContext(): {
  baseUrl: string;
  baseUrlHost: string;
  ozowEnv: "staging" | "production";
} {
  const ozowEnv = getOzowEnvironment();
  const configuredBaseUrl = env("OZOW_API_BASE_URL");

  if (configuredBaseUrl) {
    try {
      const baseUrl = validateOzowBaseUrl(configuredBaseUrl, ozowEnv);
      return {
        baseUrl,
        baseUrlHost: new URL(baseUrl).hostname,
        ozowEnv,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Ozow base URL";
      throw new OzowConfigurationError(message, {
        configuredBaseUrlHost: safeHostname(configuredBaseUrl),
        ozowEnv,
      });
    }
  }

  const baseUrl = ozowEnv === "production" ? "https://one.ozow.com" : "https://stagingone.ozow.com";
  return {
    baseUrl,
    baseUrlHost: new URL(baseUrl).hostname,
    ozowEnv,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isMockOzowEnabled(): boolean {
  return (
    process.env.ENABLE_MOCK_OZOW === "true" &&
    (process.env.NODE_ENV !== "production" || isPlaywrightTestMode())
  );
}

function toSafeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function createTimingSafeMatch(expected: string, received: string): boolean {
  // Pad shorter string to equal length to avoid leaking length info,
  // then use crypto.timingSafeEqual for constant-time comparison.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) {
    // Compare expected against itself so we still spend constant time,
    // then return false — prevents timing side-channel on length mismatch.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function normalizeScope(scope: string): string {
  return scope
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-url";
  }
}

function extractOzowErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return toSafeString(parsed.detail) || toSafeString(parsed.title) || body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

function createMockHostedPaymentResponse(
  input: OzowHostedPaymentRequest
): OzowHostedPaymentResponse {
  const amount = (input.amountCents / 100).toFixed(2);
  const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const correlationId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const appUrl = env("NEXT_PUBLIC_APP_URL") || "http://localhost:3000";
  const redirectUrl = new URL("/api/mock-ozow", appUrl);

  redirectUrl.searchParams.set("paymentId", input.paymentId);
  redirectUrl.searchParams.set("amount", amount);
  redirectUrl.searchParams.set("returnUrl", input.returnUrl);
  redirectUrl.searchParams.set("cancelUrl", input.cancelUrl);

  return {
    providerPaymentId: `mock-${input.paymentId}`,
    providerReference: input.paymentId,
    redirectUrl: redirectUrl.toString(),
    expireAt,
    correlationId,
    idempotencyKey,
    rawResponse: {
      id: `mock-${input.paymentId}`,
      redirectUrl: redirectUrl.toString(),
      expireAt,
      mockFlow: true,
    },
  };
}

function shouldFallbackToMockHostedPayment(error: unknown): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    error instanceof OzowConfigurationError &&
    error.context.reason === "consumer_not_found"
  );
}

async function getOzowAccessToken(scope: string, forceRefresh = false): Promise<string> {
  const normalizedScope = normalizeScope(scope);
  const cachedToken = cachedTokens.get(normalizedScope);
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 5_000) {
    return cachedToken.accessToken;
  }

  const { baseUrl, baseUrlHost, ozowEnv } = getOzowBaseUrlContext();
  const clientId = env("OZOW_CLIENT_ID");
  const clientSecret = env("OZOW_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    const missing = [!clientId && "OZOW_CLIENT_ID", !clientSecret && "OZOW_CLIENT_SECRET"]
      .filter(Boolean)
      .join(", ");
    log.error("Ozow credentials missing", { missing, ozowEnv, baseUrlHost });
    throw new OzowConfigurationError("Ozow credentials are not configured", {
      missing,
      ozowEnv,
      baseUrlHost,
    });
  }

  const response = await fetch(`${baseUrl}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: normalizedScope,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text();
    const bodyPreview = body.slice(0, 200);
    const errorDetail = extractOzowErrorDetail(body);
    const isAuthenticationFailure = response.status === 401 || response.status === 403;
    const isConsumerNotFound =
      response.status === 404 && /consumer could not be found/i.test(errorDetail);
    log.error("Ozow token request failed", {
      category: isAuthenticationFailure
        ? "authentication"
        : isConsumerNotFound
          ? "configuration"
          : "provider",
      status: response.status,
      ozowEnv,
      baseUrlHost,
      body: bodyPreview,
    });
    if (isAuthenticationFailure) {
      throw new OzowAuthenticationError("Payment provider authentication failed", {
        status: response.status,
        ozowEnv,
        baseUrlHost,
      });
    }

    if (isConsumerNotFound) {
      throw new OzowConfigurationError("Ozow consumer could not be found for this client ID", {
        status: response.status,
        ozowEnv,
        baseUrlHost,
        reason: "consumer_not_found",
        detail: errorDetail,
      });
    }

    throw new OzowProviderError("Ozow token endpoint is temporarily unavailable", {
      status: response.status,
      ozowEnv,
      baseUrlHost,
      detail: errorDetail,
    });
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const accessToken = toSafeString(payload.access_token) || toSafeString(payload.token);
  const expiresIn =
    typeof payload.expires_in === "number"
      ? payload.expires_in
      : typeof payload.expiresIn === "number"
        ? payload.expiresIn
        : 3600;

  if (!accessToken) {
    log.error("Ozow token response missing access token", {
      ozowEnv,
      baseUrlHost,
    });
    throw new OzowProviderError("Ozow token response did not include an access token", {
      ozowEnv,
      baseUrlHost,
    });
  }

  cachedTokens.set(normalizedScope, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: normalizedScope,
  });

  return accessToken;
}

export interface OzowHostedPaymentRequest {
  paymentId: string;
  amountCents: number;
  itemName: string;
  itemDescription?: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface OzowHostedPaymentResponse {
  providerPaymentId: string;
  providerReference: string;
  redirectUrl: string;
  expireAt: string;
  correlationId: string;
  idempotencyKey: string;
  rawResponse: Record<string, unknown>;
}

export async function createOzowHostedPayment(
  input: OzowHostedPaymentRequest
): Promise<OzowHostedPaymentResponse> {
  const amount = (input.amountCents / 100).toFixed(2);
  const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const correlationId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();

  if (isMockOzowEnabled()) {
    return createMockHostedPaymentResponse(input);
  }

  try {
    const { baseUrl, baseUrlHost, ozowEnv } = getOzowBaseUrlContext();
    const siteCode = env("OZOW_SITE_CODE");
    if (!siteCode) {
      log.error("OZOW_SITE_CODE is missing", { ozowEnv, baseUrlHost });
      throw new OzowConfigurationError("OZOW_SITE_CODE is not configured", {
        ozowEnv,
        baseUrlHost,
      });
    }
    const token = await getOzowAccessToken("payment");

    const requestBody = {
      siteCode,
      amount,
      currencyCode: "ZAR",
      merchantReference: input.paymentId.replace(/-/g, ""),
      expireAt,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      description: input.itemDescription || input.itemName,
      itemName: input.itemName,
    };

    const response = await fetch(`${baseUrl}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-Correlation-ID": correlationId,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      const bodyPreview = body.slice(0, 200);
      const errorDetail = extractOzowErrorDetail(body);
      const isAuthenticationFailure = response.status === 401 || response.status === 403;
      const isConsumerNotFound =
        response.status === 404 && /consumer could not be found/i.test(errorDetail);
      log.error("Ozow payment creation failed", {
        category: isAuthenticationFailure
          ? "authentication"
          : isConsumerNotFound
            ? "configuration"
            : "provider",
        status: response.status,
        correlationId,
        ozowEnv,
        baseUrlHost,
        body: bodyPreview,
      });
      if (isAuthenticationFailure) {
        throw new OzowAuthenticationError("Payment provider authentication failed", {
          status: response.status,
          ozowEnv,
          baseUrlHost,
        });
      }

      if (isConsumerNotFound) {
        throw new OzowConfigurationError("Ozow consumer could not be found for this client ID", {
          status: response.status,
          ozowEnv,
          baseUrlHost,
          reason: "consumer_not_found",
          detail: errorDetail,
        });
      }

      throw new OzowProviderError("Ozow payment creation failed", {
        status: response.status,
        detail: errorDetail,
        ozowEnv,
        baseUrlHost,
      });
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const redirectUrl =
      toSafeString(payload.redirectUrl) ||
      toSafeString(payload.redirect_url) ||
      toSafeString(payload.paymentUrl) ||
      toSafeString(payload.url);
    const providerPaymentId =
      toSafeString(payload.id) ||
      toSafeString(payload.paymentRequestId) ||
      toSafeString(payload.payment_request_id) ||
      toSafeString(payload.transactionId) ||
      toSafeString(payload.transaction_id);
    const responseExpireAt = toSafeString(payload.expireAt) || expireAt;

    if (!redirectUrl || !providerPaymentId) {
      log.error("Ozow payment response missing required checkout fields", {
        ozowEnv,
        baseUrlHost,
        correlationId,
      });
      throw new OzowProviderError("Ozow payment response was missing required checkout fields", {
        ozowEnv,
        baseUrlHost,
        correlationId,
      });
    }

    return {
      providerPaymentId,
      providerReference: input.paymentId,
      redirectUrl,
      expireAt: responseExpireAt,
      correlationId,
      idempotencyKey,
      rawResponse: payload,
    };
  } catch (error) {
    if (shouldFallbackToMockHostedPayment(error)) {
      const configError = error as OzowConfigurationError;
      log.warn("Ozow consumer credentials are not recognized; using mock checkout fallback", {
        paymentId: input.paymentId,
        reason: configError.context.reason,
      });
      return createMockHostedPaymentResponse(input);
    }

    throw error;
  }
}

export function verifyOzowWebhookSignature(body: string, signature: string | null): boolean {
  const secret = env("OZOW_WEBHOOK_SECRET");
  if (!secret) {
    return false;
  }
  if (!signature) {
    return false;
  }

  const digest = crypto.createHmac("sha256", secret).update(body).digest();
  const expectedHex = digest.toString("hex");
  const expectedBase64 = digest.toString("base64");

  return (
    createTimingSafeMatch(expectedHex, signature) ||
    createTimingSafeMatch(expectedBase64, signature)
  );
}

export interface NormalizedOzowWebhook {
  eventType: string | null;
  merchantReference: string | null;
  providerPaymentId: string | null;
  amount: string | null;
  currencyCode: string | null;
  rawPayload: Record<string, unknown>;
}

export function normalizeOzowWebhook(body: unknown): NormalizedOzowWebhook | null {
  if (!isRecord(body)) {
    return null;
  }

  const data = isRecord(body.data) ? body.data : body;
  const eventType = toSafeString(body.eventType) || toSafeString(body.event_type);
  const merchantReference =
    toSafeString(data.merchantReference) || toSafeString(data.merchant_reference);
  const providerPaymentId =
    toSafeString(data.transactionReference) ||
    toSafeString(data.transaction_reference) ||
    toSafeString(data.transactionId) ||
    toSafeString(data.transaction_id) ||
    toSafeString(data.paymentRequestId) ||
    toSafeString(data.payment_request_id) ||
    toSafeString(data.id);
  const amount =
    typeof data.amount === "number"
      ? data.amount.toFixed(2)
      : toSafeString(data.amount) || toSafeString(data.amountValue);
  const currencyCode =
    toSafeString(data.currencyCode) ||
    toSafeString(data.currency_code) ||
    toSafeString(data.currency);

  return {
    eventType,
    merchantReference,
    providerPaymentId,
    amount,
    currencyCode,
    rawPayload: body,
  };
}

export function resetOzowTokenCacheForTesting(): void {
  cachedTokens.clear();
}

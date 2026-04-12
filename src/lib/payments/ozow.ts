import crypto from "crypto";
import { Webhook } from "svix";
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

const MAX_CACHED_TOKENS = 20;
const cachedTokens = new Map<string, CachedToken>();
const pendingTokenFetches = new Map<string, Promise<string>>();
const OZOW_REFERENCE_FIELD_MAX_LENGTH = 14;

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
    providerReference: input.merchantReference,
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

  // Coalesce concurrent requests for the same scope into a single fetch
  const pendingKey = forceRefresh ? `${normalizedScope}:force` : normalizedScope;
  const pending = pendingTokenFetches.get(pendingKey);
  if (pending) {
    return pending;
  }

  const fetchPromise = fetchOzowAccessToken(normalizedScope);
  pendingTokenFetches.set(pendingKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    pendingTokenFetches.delete(pendingKey);
  }
}

async function fetchOzowAccessToken(normalizedScope: string): Promise<string> {
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

  // Evict expired entries and cap size to prevent unbounded growth
  if (cachedTokens.size >= MAX_CACHED_TOKENS) {
    const now = Date.now();
    for (const [k, v] of cachedTokens) {
      if (v.expiresAt <= now) cachedTokens.delete(k);
    }
    // If still at capacity, delete the oldest entry
    if (cachedTokens.size >= MAX_CACHED_TOKENS) {
      const firstKey = cachedTokens.keys().next().value;
      if (firstKey !== undefined) cachedTokens.delete(firstKey);
    }
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
  merchantReference: string;
  amountCents: number;
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

export function toOzowMerchantReference(paymentId: string): string {
  return paymentId.replace(/[^A-Za-z0-9_]/g, "");
}

/**
 * Attempt to reconstruct a UUID from a stripped merchant reference.
 * UUIDs are 8-4-4-4-12 hex chars = 32 hex chars when stripped.
 * Returns null if the input doesn't look like a stripped UUID.
 */
export function fromOzowMerchantReference(merchantReference: string): string | null {
  if (!/^[0-9a-f]{32}$/i.test(merchantReference)) {
    return null;
  }
  const m = merchantReference;
  return `${m.slice(0, 8)}-${m.slice(8, 12)}-${m.slice(12, 16)}-${m.slice(16, 20)}-${m.slice(20)}`;
}

export function toOzowReferenceField(value: string): string {
  return value.replace(/[^A-Za-z0-9 -]/g, "").slice(0, OZOW_REFERENCE_FIELD_MAX_LENGTH);
}

export async function createOzowHostedPayment(
  input: OzowHostedPaymentRequest
): Promise<OzowHostedPaymentResponse> {
  const amount = input.amountCents / 100;
  const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const correlationId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const referenceField = toOzowReferenceField(input.merchantReference);

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
    const paymentScope = env("OZOW_PAYMENT_OAUTH_SCOPE") || "payment";
    const token = await getOzowAccessToken(paymentScope);

    const requestBody = {
      siteCode,
      region: "ZA",
      amount: {
        currency: "ZAR",
        value: amount,
      },
      merchantReference: input.merchantReference,
      beneficiaryReference: referenceField,
      payerReference: referenceField,
      expireAt,
      returnUrl: input.returnUrl,
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
    const paymentResponse = isRecord(payload.payment) ? payload.payment : payload;
    const redirectUrl =
      toSafeString(paymentResponse.redirectUrl) ||
      toSafeString(paymentResponse.redirect_url) ||
      toSafeString(paymentResponse.paymentUrl) ||
      toSafeString(paymentResponse.url);
    const providerPaymentId =
      toSafeString(paymentResponse.id) ||
      toSafeString(paymentResponse.paymentRequestId) ||
      toSafeString(paymentResponse.payment_request_id) ||
      toSafeString(paymentResponse.transactionId) ||
      toSafeString(paymentResponse.transaction_id);
    const responseExpireAt = toSafeString(paymentResponse.expireAt) || expireAt;

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
      providerReference: input.merchantReference,
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

export function verifyOzowWebhookSignature(body: string, headers: Pick<Headers, "get">): boolean {
  const secret = env("OZOW_WEBHOOK_SECRET");
  if (!secret) {
    log.error("OZOW_WEBHOOK_SECRET is not configured — all webhooks will be rejected");
    return false;
  }

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  try {
    new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
    return true;
  } catch {
    return false;
  }
}

export interface NormalizedOzowWebhook {
  eventType: string | null;
  merchantReference: string | null;
  providerPaymentId: string | null;
  status: string | null;
  amount: string | null;
  currencyCode: string | null;
  rawPayload: Record<string, unknown>;
}

export function normalizeOzowWebhook(body: unknown): NormalizedOzowWebhook | null {
  if (!isRecord(body)) {
    return null;
  }

  const data = isRecord(body.data) ? body.data : body;
  const transaction = isRecord(data.transaction) ? data.transaction : data;
  const amountObject = isRecord(transaction.amount) ? transaction.amount : null;
  const eventType =
    toSafeString(body.eventType) || toSafeString(body.event_type) || toSafeString(body.type);
  const merchantReference =
    toSafeString(transaction.merchantReference) || toSafeString(transaction.merchant_reference);
  const providerPaymentId =
    toSafeString(transaction.transactionReference) ||
    toSafeString(transaction.transaction_reference) ||
    toSafeString(transaction.transactionId) ||
    toSafeString(transaction.transaction_id) ||
    toSafeString(transaction.paymentRequestId) ||
    toSafeString(transaction.payment_request_id) ||
    toSafeString(transaction.id);
  const status = toSafeString(transaction.status) || toSafeString(data.status);
  const amountValue = amountObject?.value;
  const amount =
    typeof amountValue === "number"
      ? amountValue.toFixed(2)
      : typeof transaction.amount === "number"
        ? transaction.amount.toFixed(2)
        : toSafeString(transaction.amount) || toSafeString(transaction.amountValue);
  const currencyCode =
    toSafeString(amountObject?.currency) ||
    toSafeString(transaction.currencyCode) ||
    toSafeString(transaction.currency_code) ||
    toSafeString(transaction.currency);

  return {
    eventType,
    merchantReference,
    providerPaymentId,
    status,
    amount,
    currencyCode,
    rawPayload: body,
  };
}

export function resetOzowTokenCacheForTesting(): void {
  cachedTokens.clear();
}

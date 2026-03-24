import crypto from "crypto";
import { env } from "@/lib/config/env";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Ozow");

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

function getOzowBaseUrl(): string {
  const configuredBaseUrl = env("OZOW_API_BASE_URL");
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, "");
  }

  return env("OZOW_ENV") === "production" ? "https://one.ozow.com" : "https://stagingone.ozow.com";
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

async function getOzowAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 5_000) {
    return cachedToken.accessToken;
  }

  const clientId = env("OZOW_CLIENT_ID");
  const clientSecret = env("OZOW_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Ozow credentials are not configured");
  }

  const response = await fetch(`${getOzowBaseUrl()}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error("Ozow token request failed", { status: response.status, body });
    throw new Error("Failed to authenticate with Ozow");
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
    throw new Error("Ozow token response did not include an access token");
  }

  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

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

  const token = await getOzowAccessToken();
  const siteCode = env("OZOW_SITE_CODE");
  if (!siteCode) {
    throw new Error("OZOW_SITE_CODE is not configured");
  }

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

  const response = await fetch(`${getOzowBaseUrl()}/v1/payments`, {
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
    log.error("Ozow payment creation failed", {
      status: response.status,
      correlationId,
      body,
    });
    throw new Error("Failed to create Ozow payment");
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
    throw new Error("Ozow payment response was missing required checkout fields");
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
  cachedToken = null;
}

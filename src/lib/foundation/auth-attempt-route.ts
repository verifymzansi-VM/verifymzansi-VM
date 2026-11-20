import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { FoundationAuthCookies } from "@/lib/foundation/auth-attempt";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { clientSignupKeys } from "@/lib/utils/client-network-key";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FoundationAuth");

/** Spends one attempt from each sign-up bucket once Auth has handled it. A
 * limiter outage here changes nothing: the check before Auth was asked
 * already failed closed. */
async function spend(limits: { key: string; action: string }[]) {
  for (const bucket of limits) await checkRateLimit({ ...bucket, degradedMode: "block" });
}

/** Whether a sign-up body carries a CAPTCHA token (both registration forms
 * send it as `turnstileToken`); its validity is Auth's to check. */
function hasCaptchaToken(input: unknown) {
  if (typeof input !== "object" || input === null) return false;
  const token = (input as { turnstileToken?: unknown }).turnstileToken;
  return typeof token === "string" && token.trim().length > 0;
}

export function foundationAuthPrivateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

/** Anonymous Auth still requires same-origin CSRF, shared protection and
 * bounded ingress. Commit staged cookies only for an accepted operation.
 * Each operation maps safe errors; provider diagnostics stay private.
 */
export async function handleFoundationAuthAttempt<T>({
  request,
  action,
  enabled = true,
  unavailableMessage,
  operation,
  refusal,
  countsAsAttempt,
}: {
  request: NextRequest;
  action: "auth:login" | "auth:register" | "auth:forgot-password" | "auth:resend-confirmation";
  enabled?: boolean;
  unavailableMessage: string;
  operation: (
    connection: ReturnType<typeof readFoundationRuntimeConnection>,
    input: unknown,
    cookies: FoundationAuthCookies
  ) => Promise<T>;
  refusal: (error: unknown) => { status: number; error: string; code?: string } | null;
  /** Sign-up only: whether a failed operation still counts against the
   * limits (Auth was asked and did not refuse the CAPTCHA). A completed
   * operation always counts. */
  countsAsAttempt?: (error: unknown) => boolean;
}) {
  const unavailable = () =>
    foundationAuthPrivateResponse(
      NextResponse.json({ error: unavailableMessage }, { status: 503 })
    );
  try {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return foundationAuthPrivateResponse(blocked);
    if (!enabled || process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha")
      return unavailable();
    const connection = readFoundationRuntimeConnection();
    let input: unknown;
    let limits: { key: string; action: string }[];
    const signUp = action === "auth:register";
    if (signUp) {
      // Sign-up counts only real attempts, so junk cannot lock out a shared
      // network: a request without a CAPTCHA token is refused at once; the
      // limits are only checked (not spent) before Auth is asked, and spent
      // afterwards unless Auth refused the CAPTCHA (see below). It counts per
      // IPv4 address or IPv6 /64, and more loosely per IPv6 /48
      // (clientSignupKeys).
      input = await parseJsonRequest(request, { maxBytes: 4096 });
      if (!hasCaptchaToken(input))
        return foundationAuthPrivateResponse(
          NextResponse.json(
            { error: "Check the registration details and complete the CAPTCHA" },
            { status: 400 }
          )
        );
      const keys = clientSignupKeys(request);
      limits = [{ key: keys.address, action }];
      if (keys.network) limits.push({ key: keys.network, action: "auth:register:network" });
    } else limits = [{ key: getClientRateLimitIdentity(request).key, action }];
    for (const bucket of limits) {
      const limit = await checkRateLimit({
        ...bucket,
        degradedMode: "block",
        ...(signUp ? { readOnly: true } : {}),
      });
      if (limit.degraded || limit.limited)
        return foundationAuthPrivateResponse(
          NextResponse.json(
            { error: limit.degraded ? unavailableMessage : "Too many attempts; try again shortly" },
            {
              status: limit.degraded ? 503 : 429,
              headers: { "Retry-After": String(limit.retryAfter ?? 60) },
            }
          )
        );
    }
    if (action !== "auth:register") input = await parseJsonRequest(request, { maxBytes: 4096 });
    const writes: Parameters<FoundationAuthCookies["setAll"]>[0] = [];
    let result: T;
    try {
      result = await operation(connection, input, {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          writes.push(...items);
        },
      });
    } catch (error) {
      if (signUp && countsAsAttempt?.(error)) await spend(limits);
      throw error;
    }
    if (signUp) await spend(limits);
    const response = foundationAuthPrivateResponse(NextResponse.json(result));
    for (const { name, value, options } of writes) response.cookies.set(name, value, options);
    return response;
  } catch (error) {
    const known = refusal(error);
    return known
      ? foundationAuthPrivateResponse(
          NextResponse.json(
            { error: known.error, ...(known.code ? { code: known.code } : {}) },
            {
              status: known.status,
              headers: known.status === 429 ? { "Retry-After": "60" } : undefined,
            }
          )
        )
      : unavailable();
  }
}

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { FoundationAuthCookies } from "@/lib/foundation/auth-attempt";
import { confirmFoundationAccount } from "@/lib/foundation/auth-confirmation";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";
import { FOUNDATION_POST_SIGNUP_PATH } from "@/lib/foundation/auth-navigation";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { foundationAuthPrivateResponse } from "./attempt-route";
import { EMAIL_CHANGE_LANDING_PARAM } from "./email-change-landing";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { ACQUISITION_COOKIE } from "@/lib/analytics/acquisition";
import { recordRestoredAcquisitionCookie } from "@/lib/foundation/partners";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";
import {
  RECOVERY_LINK_PARAM,
  RECOVERY_PAGE_PATH,
  recoveryBindingCookieName,
  recoveryBindingCookieOptions,
  sealRecoveryBinding,
} from "@/lib/foundation/recovery-binding";

/** A Google sign-in that has just created the account goes to the phone step
 * first, as an email sign-up does after confirming (and as the restored site
 * did). That page sends anyone whose number is already verified straight on.
 * Older accounts, including email accounts that now add Google, are not new. */
const NEW_GOOGLE_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

export function googleLandingPath(next: string, createdAt: string | null, now = Date.now()) {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (
    !Number.isFinite(created) ||
    now - created > NEW_GOOGLE_ACCOUNT_WINDOW_MS ||
    created - now > CLOCK_SKEW_MS
  )
    return next;
  if (next === "/" || next === "/dashboard") return FOUNDATION_POST_SIGNUP_PATH;
  return `${FOUNDATION_POST_SIGNUP_PATH}?${new URLSearchParams({ returnUrl: next })}`;
}

/** Fixed text of the sign-up guard (internal.acceptance_signup_guard) while
 * registration is by invitation only. */
const REGISTRATION_CLOSED_TEXT = "registration is not open yet";

/** Why Auth sent a Google sign-in back without a code, as one of two fixed
 * login-page reasons. Nothing from the query is echoed back to the page. */
export function googleRefusalPath(query: URLSearchParams): string | null {
  if (query.get("oauth") !== "google" || !query.has("error")) return null;
  if (query.get("error_description")?.toLowerCase().includes(REGISTRATION_CLOSED_TEXT))
    return "/login?error=registration_closed#";
  if (query.get("error") === "access_denied") return "/login?error=google_cancelled#";
  return null;
}

/** PKCE protects this top-level email navigation; it cannot require the
 * mutation CSRF header used by in-app POSTs. The flow id selects one verifier.
 * Invalid attempts clear verifier state without publishing an unverified session.
 */
export async function handleFoundationConfirmation(
  incoming: Request,
  purpose: "signup" | "recovery" | "google" = "signup"
) {
  const request = new NextRequest(incoming.url, { headers: incoming.headers });
  const origin = resolveAppOrigin(incoming);
  const writes: Parameters<FoundationAuthCookies["setAll"]>[0] = [];
  let success = false;
  let sessionName: string | undefined;
  let retryAfter: number | undefined;
  let binding: ReturnType<typeof sealRecoveryBinding> | undefined;
  let createdAt: string | null = null;
  const googleRefusal =
    purpose === "google" ? googleRefusalPath(request.nextUrl.searchParams) : null;
  try {
    if (
      process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha" ||
      process.env.FOUNDATION_AUTH_CALLBACK_ENABLED !== "true" ||
      (purpose === "recovery" && process.env.FOUNDATION_RECOVERY_ENABLED !== "true")
    )
      throw new Error();
    const config = readFoundationRuntimeConnection();
    sessionName = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
    const query = request.nextUrl.searchParams;
    if (
      query.getAll("backend").length !== 1 ||
      query.get("backend") !== "foundation" ||
      query.getAll("code").length !== 1 ||
      query.getAll("sb_flow_id").length !== 1 ||
      query.has("token_hash") ||
      query.has("error") ||
      // Email change links are handled apart and never open a session.
      query.has(EMAIL_CHANGE_LANDING_PARAM)
    )
      throw new Error();
    if (
      purpose === "recovery"
        ? query.getAll("recovery").length !== 1 || query.get("recovery") !== "1"
        : query.has("recovery")
    )
      throw new Error();
    if (
      purpose === "google"
        ? query.getAll("oauth").length !== 1 || query.get("oauth") !== "google"
        : query.has("oauth")
    )
      throw new Error();
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "auth:login",
      degradedMode: "block",
    });
    if (limit.degraded || limit.limited) {
      retryAfter = limit.retryAfter ?? 60;
      throw new Error();
    }
    const values = new Map(request.cookies.getAll().map(({ name, value }) => [name, value]));
    const confirmed = await confirmFoundationAccount(
      config,
      { code: query.get("code"), flowId: query.get("sb_flow_id") },
      {
        getAll: () => [...values].map(([name, value]) => ({ name, value })),
        setAll: (items) => {
          for (const item of items) values.set(item.name, item.value);
          writes.push(...items);
        },
      },
      undefined,
      purpose
    );
    const { api, accountId, recovery } = confirmed;
    createdAt = confirmed.createdAt;
    // Remember, in this browser only, which verified recovery session this
    // link opened; the reset page completes only with that session.
    if (purpose === "recovery") {
      if (!recovery) throw new Error();
      binding = sealRecoveryBinding({ accountId, ...recovery });
    }
    // A recovery success always carries its binding (set just above).
    success = purpose !== "recovery" || binding !== undefined;
    if (purpose !== "recovery") {
      const cookie = request.headers
        .get("cookie")
        ?.split(/;\s*/)
        .find((part) => part.startsWith(ACQUISITION_COOKIE + "="));
      if (cookie)
        scheduleBackgroundTask(
          recordRestoredAcquisitionCookie(api, cookie.slice(ACQUISITION_COOKIE.length + 1)),
          "partner attribution"
        );
    }
  } catch {
    // Never expose codes, verifier values, provider responses or account ids.
  }
  const response = foundationAuthPrivateResponse(
    NextResponse.redirect(
      new URL(
        success
          ? purpose === "recovery"
            ? `${RECOVERY_PAGE_PATH}?${RECOVERY_LINK_PARAM}=${binding?.marker}`
            : purpose === "google"
              ? googleLandingPath(
                  sanitizeReturnUrl(request.nextUrl.searchParams.get("next")),
                  createdAt
                )
              : FOUNDATION_POST_SIGNUP_PATH
          : // The empty fragment replaces the one Auth put on a refused link
            // (its error details), which browsers otherwise carry along.
            purpose === "recovery"
            ? "/forgot-password?error=recovery_failed#"
            : (googleRefusal ?? "/login?error=auth_callback_failed#"),
        origin
      ),
      303
    )
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  for (const { name, value, options } of writes) {
    const verifierOnly =
      sessionName && name.startsWith(sessionName + "-") && /-code-verifier(?:\.\d+)?$/.test(name);
    if (success || verifierOnly) response.cookies.set(name, value, options);
  }
  if (success && binding)
    response.cookies.set(
      recoveryBindingCookieName(origin),
      binding.value,
      recoveryBindingCookieOptions(origin, binding.maxAge)
    );
  return response;
}

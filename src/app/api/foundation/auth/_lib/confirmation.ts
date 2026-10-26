import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { FoundationAuthCookies } from "@/lib/foundation/auth-attempt";
import { confirmFoundationAccount } from "@/lib/foundation/auth-confirmation";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";
import { FOUNDATION_POST_SIGNUP_PATH } from "@/lib/foundation/auth-navigation";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { foundationAuthPrivateResponse } from "./attempt-route";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";

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
      query.has("error")
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
    await confirmFoundationAccount(
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
    success = true;
  } catch {
    // Never expose codes, verifier values, provider responses or account ids.
  }
  const response = foundationAuthPrivateResponse(
    NextResponse.redirect(
      new URL(
        success
          ? purpose === "recovery"
            ? "/reset-password"
            : purpose === "google"
              ? sanitizeReturnUrl(request.nextUrl.searchParams.get("next"))
              : FOUNDATION_POST_SIGNUP_PATH
          : purpose === "recovery"
            ? "/forgot-password?error=recovery_failed"
            : "/login?error=confirmation_failed",
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
  return response;
}

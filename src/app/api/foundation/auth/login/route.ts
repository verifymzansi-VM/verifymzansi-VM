import { NextResponse, type NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";
import {
  FoundationPasswordAuthError,
  signInFoundationPassword,
} from "@/lib/foundation/password-auth";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FoundationLogin");

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

/** Inert until target-native CAPTCHA is prepared. The existing live login
 * keeps its own integration until the complete foundation cutover rehearsal.
 */
export async function POST(request: NextRequest) {
  try {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return privateResponse(blocked);
    if (process.env.FOUNDATION_PASSWORD_AUTH_MODE !== "native-captcha")
      throw new FoundationPasswordAuthError(503);
    const connection = readFoundationRuntimeConnection();
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "auth:login",
      degradedMode: "block",
    });
    if (limit.degraded || limit.limited)
      return privateResponse(
        NextResponse.json(
          {
            error: limit.degraded
              ? "Sign-in is temporarily unavailable"
              : "Too many attempts; try again shortly",
          },
          {
            status: limit.degraded ? 503 : 429,
            headers: { "Retry-After": String(limit.retryAfter ?? 60) },
          }
        )
      );
    const input = await parseJsonRequest(request, { maxBytes: 4096 });
    const writes: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0] = [];
    await signInFoundationPassword(connection, input, {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        writes.push(...items);
      },
    });
    const response = privateResponse(NextResponse.json({ ok: true }));
    for (const { name, value, options } of writes) response.cookies.set(name, value, options);
    return response;
  } catch (error) {
    const failure =
      error instanceof FoundationPasswordAuthError ? error : new FoundationPasswordAuthError(503);
    return privateResponse(
      NextResponse.json(
        { error: failure.message },
        {
          status: failure.status,
          headers: failure.status === 429 ? { "Retry-After": "60" } : undefined,
        }
      )
    );
  }
}

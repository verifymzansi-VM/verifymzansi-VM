import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { FoundationAuthCookies } from "@/lib/foundation/auth-attempt";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FoundationAuth");

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
}: {
  request: NextRequest;
  action: "auth:login" | "auth:register" | "auth:forgot-password";
  enabled?: boolean;
  unavailableMessage: string;
  operation: (
    connection: ReturnType<typeof readFoundationRuntimeConnection>,
    input: unknown,
    cookies: FoundationAuthCookies
  ) => Promise<T>;
  refusal: (error: unknown) => { status: number; error: string } | null;
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
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action,
      degradedMode: "block",
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
    const input = await parseJsonRequest(request, { maxBytes: 4096 });
    const writes: Parameters<FoundationAuthCookies["setAll"]>[0] = [];
    const result = await operation(connection, input, {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        writes.push(...items);
      },
    });
    const response = foundationAuthPrivateResponse(NextResponse.json(result));
    for (const { name, value, options } of writes) response.cookies.set(name, value, options);
    return response;
  } catch (error) {
    const known = refusal(error);
    return known
      ? foundationAuthPrivateResponse(
          NextResponse.json(
            { error: known.error },
            {
              status: known.status,
              headers: known.status === 429 ? { "Retry-After": "60" } : undefined,
            }
          )
        )
      : unavailable();
  }
}

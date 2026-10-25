import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientIp, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
const log = createLogger("FoundationReport");
const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" };
const bodySchema = z.object({
  targetId: z.uuid(),
  targetType: z.enum(["listing", "business", "promotion"]),
  reason: z.enum([
    "scam",
    "misleading",
    "expired",
    "fake_listing",
    "prohibited_item",
    "harassment",
    "impersonation",
    "spam",
    "other",
  ]),
  description: z.string().trim().min(10).max(2000),
  turnstileToken: z.string().min(1).max(4096),
});
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const input = bodySchema.safeParse(await parseJsonRequest(request, { maxBytes: 8192 }));
  if (!input.success)
    return NextResponse.json(
      { error: "Choose a report reason and describe the issue" },
      { status: 400, headers }
    );
  const captcha = await verifyPublicTurnstile(request, input.data.turnstileToken, log);
  if (captcha) return captcha;
  const context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "reports:create",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          { error: "Report protection unavailable or too many reports" },
          { status: limit.degraded ? 503 : 429, headers }
        )
      );
    let actor: string | null = null;
    try {
      actor = (await context.authenticateCaller()).accountId;
    } catch (error) {
      if (!(error instanceof FoundationSessionError) || error.status === 503) throw error;
    }
    const secret = process.env.IP_HASH_SECRET;
    if (!secret || secret.length < 32) throw new Error();
    const category = ["scam", "prohibited_item", "impersonation", "harassment"].includes(
      input.data.reason
    )
      ? input.data.reason
      : "misleading_info";
    const description = `[${input.data.reason}] ${input.data.description}`.slice(0, 2000);
    const result = await createFoundationServiceApi().rpc("submit_report", {
      p_post_id: input.data.targetId,
      p_category: category,
      p_description: description,
      p_reporter_ip_hmac: createHmac("sha256", secret)
        .update(`report/v1:${getClientIp(request) || "unknown"}`)
        .digest("base64url"),
      ...(actor ? { p_reporter_id: actor } : {}),
    });
    if (result.error)
      return context.respond(
        NextResponse.json(
          {
            error:
              "This post could not be reported. Check that it is still public and does not belong to you.",
          },
          { status: result.error.code === "42501" ? 403 : 400, headers }
        )
      );
    return context.respond(NextResponse.json({ success: true }, { headers }));
  } catch {
    return context.respond(
      NextResponse.json({ error: "Your report could not be submitted" }, { status: 503, headers })
    );
  }
}

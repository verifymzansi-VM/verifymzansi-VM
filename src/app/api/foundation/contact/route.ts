import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { createLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
const log = createLogger("FoundationContact");
const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" };
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const input = z
    .strictObject({
      post_id: z.uuid(),
      channel: z.enum(["call", "whatsapp"]),
      turnstile_token: z.string().min(1).max(4096),
    })
    .safeParse(await parseJsonRequest(request, { maxBytes: 8192 }));
  if (!input.success)
    return NextResponse.json(
      { error: "Complete the challenge and choose a contact option" },
      { status: 400, headers }
    );
  const captcha = await verifyPublicTurnstile(request, input.data.turnstile_token, log);
  if (captcha) return captcha;
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "contact:reveal",
      degradedMode: "block",
    });
    if (limit.limited)
      return NextResponse.json(
        { error: "Contact protection unavailable or too many requests" },
        { status: limit.degraded ? 503 : 429, headers }
      );
    const { data, error } = await createFoundationServiceApi().rpc("reveal_post_phone", {
      p_post_id: input.data.post_id,
      p_channel: input.data.channel,
    });
    if (error) throw new Error();
    if (typeof data !== "string" || !/^\+27[0-9]{9}$/.test(data))
      return NextResponse.json(
        { error: "This contact option is unavailable" },
        { status: 404, headers }
      );
    return NextResponse.json({ phone: data }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Contact options could not be loaded" },
      { status: 503, headers }
    );
  }
}

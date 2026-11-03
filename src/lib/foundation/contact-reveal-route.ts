import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { foundationServerPublicApi } from "./server-public";
import { readFoundationPublicPost, readFoundationPublicContactChannels } from "./public-post";
import { createFoundationServiceApi } from "./service-api";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { parseJsonRequest } from "../utils/api";
import { verifyPublicTurnstile } from "../utils/public-mutation-route";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { createLogger } from "../utils/logger";

const log = createLogger("PublicContactReveal");
const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" };
const input = z.strictObject({
  targetType: z.enum(["listing", "business", "promotion"]),
  targetId: z.uuid(),
  turnstileToken: z.string().min(1).max(4096),
});
const phone = z
  .string()
  .regex(/^\+27[0-9]{9}$/)
  .nullable();

/** Compatibility with the selected frontend, using only approved channels and
 * a fresh, single-use challenge. Phone values never enter public page reads. */
export async function revealFoundationContact(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const parsed = input.safeParse(await parseJsonRequest(request, { maxBytes: 8192 }));
  if (!parsed.success)
    return NextResponse.json({ error: "Complete the contact challenge" }, { status: 400, headers });
  const captcha = await verifyPublicTurnstile(request, parsed.data.turnstileToken, log);
  if (captcha) return captcha;
  try {
    const rate = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "contact:reveal",
      degradedMode: "block",
    });
    if (rate.limited)
      return NextResponse.json(
        { error: "Contact protection unavailable or too many requests" },
        { status: rate.degraded ? 503 : 429, headers }
      );
    const api = foundationServerPublicApi();
    const post = await readFoundationPublicPost(api, { id: parsed.data.targetId });
    const expected = parsed.data.targetType === "promotion" ? "event" : parsed.data.targetType;
    if (!post || post.kind !== expected)
      return NextResponse.json({ error: "Post not found" }, { status: 404, headers });
    const channels = await readFoundationPublicContactChannels(api, { id: post.id });
    const service = createFoundationServiceApi();
    const reveal = async (channel: "call" | "whatsapp") => {
      if (!channels.includes(channel)) return null;
      const { data, error } = await service.rpc("reveal_post_phone", {
        p_post_id: post.id,
        p_channel: channel,
      });
      if (error) throw new Error("Contact reveal unavailable");
      return phone.parse(data);
    };
    const [call, whatsapp] = await Promise.all([reveal("call"), reveal("whatsapp")]);
    if (!call && !whatsapp)
      return NextResponse.json(
        { error: "This contact option is unavailable" },
        { status: 404, headers }
      );
    return NextResponse.json({ phone: call, whatsapp, email: null }, { headers });
  } catch {
    return NextResponse.json(
      { error: "Contact options could not be loaded" },
      { status: 503, headers }
    );
  }
}

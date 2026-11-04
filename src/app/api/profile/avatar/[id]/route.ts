import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { readFoundationAccountContext } from "@/lib/foundation/account-context";
import { resolveOwnedMedia } from "@/lib/foundation/owned-media";
import { foundationMediaUrl } from "@/lib/foundation/public-media-url";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let context: ReturnType<typeof createFoundationRouteContext> | undefined;
  const unavailable = () =>
    NextResponse.json(
      { error: "Avatar unavailable" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    );
  try {
    const id = z
      .uuid()
      .parse((await params).id)
      .toLowerCase();
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "inbox:read",
      degradedMode: "block",
    });
    if (limit.limited || limit.degraded) return context.respond(unavailable());
    const api = await context.authenticate(),
      account = await readFoundationAccountContext(api);
    if (account.profile.avatar_object_id !== id) return context.respond(unavailable());
    const resolved = await resolveOwnedMedia(api, { ids: [id] });
    const avatar = resolved.find((m) => m.object_id === id && m.kind === "image");
    const url = avatar && foundationMediaUrl(avatar.object_key);
    if (!url) return context.respond(unavailable());
    return context.respond(NextResponse.redirect(url, 302));
  } catch {
    return context ? context.respond(unavailable()) : unavailable();
  }
}

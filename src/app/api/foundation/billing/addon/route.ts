import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import { parseJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { createLogger } from "@/lib/utils/logger";
const log = createLogger("FoundationAddonCheckout");
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const input = z
    .strictObject({
      post_id: z.uuid(),
      kind: z.enum(["boost", "featured", "urgent"]),
      days: z.number().int().min(1).max(90),
    })
    .safeParse(await parseJsonRequest(request, { maxBytes: 2048 }));
  if (!input.success)
    return NextResponse.json(
      { error: "Choose an available add-on for your post" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  return handleFoundationBillingRoute(request, "checkout", {
    postId: input.data.post_id,
    kind: input.data.kind,
    days: input.data.days,
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPostingAllowance } from "@/lib/commercial/allowance";
import { createLogger } from "@/lib/utils/logger";
import type { MarketplaceArea } from "@/types/enums";

const log = createLogger("BillingAllowance");
const AREAS: readonly MarketplaceArea[] = ["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"];

/**
 * GET /api/billing/allowance?area=MZANSI_MARKET
 * The signed-in member's active slot capacity and usage in one area, for the
 * posting UI. Informational only: create routes re-check on the server.
 */
export async function GET(request: NextRequest) {
  const area = request.nextUrl.searchParams.get("area") as MarketplaceArea | null;
  if (!area || !AREAS.includes(area)) {
    return NextResponse.json({ error: "Invalid area" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [allowance, used] = await Promise.all([
      getPostingAllowance(user.id, area),
      createAdminClient().rpc("posting_area_used", { p_user_id: user.id, p_area: area }),
    ]);
    return NextResponse.json(
      { ...allowance, used: typeof used.data === "number" ? used.data : 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    log.error("Failed to load posting allowance", {
      userId: user.id,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Unable to load plan details" }, { status: 503 });
  }
}

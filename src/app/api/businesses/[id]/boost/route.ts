import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canBoost } from "@/lib/services/entitlements";
import { logAuditEvent } from "@/lib/services/audit";
import { ADDON_PRICES, BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { createHostedCheckout } from "@/lib/payments/checkout";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";
import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  ACCOUNT_PROFILE_WRITE_TABLE,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";

const log = createLogger("BoostBusiness");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type BusinessCheckoutRow = {
  id: string;
  business_name: string;
  status: string;
  boost_until?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

/**
 * POST /api/businesses/[id]/boost
 *
 * Create an Ozow checkout session to boost a business.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: businessId } = await params;

    if (!UUID_RE.test(businessId)) {
      return NextResponse.json({ error: "Invalid business ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "businesses");

    const { data: accountProfile } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!accountProfile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    const { data: rawBusiness } = await admin
      .from("businesses")
      .select(withOwnerColumn("id, business_name, status, owner_id, boost_until", ownerColumn))
      .eq("id", businessId)
      .maybeSingle();
    const business = rawBusiness as BusinessCheckoutRow | null;

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (readOwnerId(business) !== user.id) {
      return NextResponse.json({ error: "You don't own this business" }, { status: 403 });
    }

    if (business.status !== "live") {
      return NextResponse.json({ error: "Only live businesses can be boosted" }, { status: 400 });
    }

    if (business.boost_until && new Date(business.boost_until) > new Date()) {
      return NextResponse.json({ error: "This business is already boosted" }, { status: 400 });
    }

    const tier = await getActivePlanTierForArea(user.id, "MZANSI_BUSINESS");
    const boostCheck = canBoost(tier, "MZANSI_BUSINESS");

    if (!boostCheck.allowed) {
      return NextResponse.json({ error: boostCheck.reason }, { status: 403 });
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
    const { paymentId, checkoutUrl } = await createHostedCheckout({
      admin: admin as never,
      userId: user.id,
      area: "MZANSI_BUSINESS",
      amountCents: ADDON_PRICES.boost,
      itemName: `Boost: ${business.business_name}`.slice(0, 100),
      itemDescription: `${BOOST_DURATION_DAYS}-day business boost`,
      returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
      cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
      providerData: {
        type: "boost_business",
        business_id: businessId,
        boost_days: BOOST_DURATION_DAYS,
      },
    });

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "business_boosted",
        targetType: "business",
        targetId: businessId,
        area: "MZANSI_BUSINESS",
        metadata: {
          paymentId,
          amount: ADDON_PRICES.boost / 100,
          boostDays: BOOST_DURATION_DAYS,
          status: "checkout_initiated",
        },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
        paymentId,
      });
    }

    return NextResponse.json({ success: true, checkoutUrl, paymentId });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to create boost checkout" }, { status: 500 });
  }
}

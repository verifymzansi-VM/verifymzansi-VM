import { addonSalesPausedResponse, areAddonSalesOpen } from "@/lib/billing/addon-sales";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";

type AddonKind = "boost" | "featured" | "urgent";

type AddonCheckoutConfig = {
  validationErrorMessage: string;
  /** Names the entry point in the paused-sales log line; its first word is the add-on kind. */
  paymentType: AddonKind | `${AddonKind}_business` | `${AddonKind}_promotion`;
  durationDays: number;
};

const addonParamsSchema = z.object({ id: uuidSchema });

/**
 * POST handler for /api/{listings,businesses,promotions}/[id]/{boost,featured,urgent}.
 * Sign-in, ownership, eligibility and the checkout itself belong to the
 * foundation billing handler; this wrapper only refuses paused sales and
 * malformed post ids first.
 */
export function createAddonCheckoutRouteCore(config: AddonCheckoutConfig) {
  const kind = config.paymentType.split("_")[0] as AddonKind;
  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    // Paused add-on sales (src/lib/billing/addon-sales.ts) stop here, before
    // any session, table or provider work.
    if (!areAddonSalesOpen()) return addonSalesPausedResponse(config.paymentType);
    const parsed = parseAndValidateRouteParams(await params, addonParamsSchema, {
      validationErrorMessage: config.validationErrorMessage,
      includeValidationDetails: false,
    });
    if (!parsed.success) return parsed.response;
    return handleFoundationBillingRoute(request, "checkout", {
      postId: parsed.data.id,
      kind,
      days: config.durationDays,
    });
  };
}

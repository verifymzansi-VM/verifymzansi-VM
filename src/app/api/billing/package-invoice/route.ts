import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { invoiceRouteRefusal } from "@/lib/foundation/customer-invoices";
import {
  packageInvoiceRequestInput,
  requestPackageInvoice,
} from "@/lib/foundation/package-invoices";

const log = createLogger("PackageInvoiceRequest");

/**
 * POST /api/billing/package-invoice
 * "Ask for an invoice" for a Multi-listing package (roadmap P4e): the signed-in
 * member's term, number of slots, the total they were shown, the ticked
 * cooling-off box and a request id (a retried submission returns the first
 * answer). Same-origin and CSRF, a rate limit and a GoTrue-verified session
 * (the owner route); the database prices the order and checks every rule
 * again, including that packages are on sale.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "billing:checkout",
    mutate: true,
    requireCaller: true,
    maxBytes: 4096,
    signInMessage: "Sign in to ask for an invoice",
    unavailableMessage: "Your request could not be sent. Please try again in a few minutes.",
    refusal: invoiceRouteRefusal,
    command: async (api, input) => ({
      success: true,
      request: await requestPackageInvoice(api, packageInvoiceRequestInput.parse(input)),
    }),
  });
}

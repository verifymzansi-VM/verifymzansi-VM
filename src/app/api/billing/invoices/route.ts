import { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  invoiceBillingInput,
  invoicePaymentInput,
  invoiceRouteRefusal,
  saveMyInvoiceBilling,
  startMyInvoicePayment,
} from "@/lib/foundation/customer-invoices";

const log = createLogger("CustomerInvoices");

const body = z.discriminatedUnion("action", [
  invoiceBillingInput.extend({ action: z.literal("billing") }),
  invoicePaymentInput.extend({ action: z.literal("pay") }),
]);

/**
 * POST /api/billing/invoices
 * The signed-in owner of an invoice saves its billing details ("billing") or
 * pays it with Ozow ("pay": the cooling-off box ticked; the answer names
 * Ozow's page). Same-origin and CSRF, a rate limit and a GoTrue-verified
 * session (the owner route); the database checks the owner, the invoice and
 * every rule again.
 */
export async function POST(request: Request) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "billing:checkout",
    mutate: true,
    requireCaller: true,
    maxBytes: 4096,
    signInMessage: "Sign in to pay your invoice",
    unavailableMessage: "The invoice could not be updated. Reload the page before trying again.",
    refusal: invoiceRouteRefusal,
    command: async (api, input, caller) => {
      const value = body.parse(input);
      if (value.action === "billing") {
        const { action: _action, ...billing } = value;
        return { success: true, invoice: await saveMyInvoiceBilling(api, billing) };
      }
      const { action: _action, ...payment } = value;
      if (!caller) throw new Error("caller required");
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://verifymzansi.com";
      return {
        success: true,
        ...(await startMyInvoicePayment(api, caller.accountId, payment, appUrl)),
      };
    },
  });
}

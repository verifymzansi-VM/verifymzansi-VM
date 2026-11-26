import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { logRequestFailure } from "@/lib/utils/request-failure";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import {
  invoiceLinkBillingInput,
  invoiceLinkPaymentInput,
  invoiceRouteRefusal,
  saveInvoiceBillingByLink,
  startInvoicePaymentByLink,
} from "@/lib/foundation/customer-invoices";

const log = createLogger("InvoicePaymentLink");
const ACTION = "billing:checkout";

const body = z.discriminatedUnion("action", [
  invoiceLinkBillingInput.extend({ action: z.literal("billing") }),
  invoiceLinkPaymentInput.extend({ action: z.literal("pay") }),
]);

/**
 * POST /api/pay-invoice
 * The payer of an emailed invoice, not signed in, saves its billing details
 * ("billing") or pays it with Ozow ("pay": the cooling-off box ticked; the
 * answer names Ozow's page). Same-origin and CSRF, a rate limit per client and
 * a small body; the payment link's token is the only thing that names the
 * invoice, and the database checks the invoice and every rule again.
 */
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let service: ReturnType<typeof createFoundationServiceApi> | undefined;
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: ACTION,
      degradedMode: "block",
    });
    if (limit.limited)
      return NextResponse.json(
        { error: "Too many requests; try again shortly" },
        {
          status: limit.degraded ? 503 : 429,
          headers: { ...foundationNoStore, "Retry-After": String(limit.retryAfter ?? 60) },
        }
      );
    const input = await parseJsonRequest(request, { maxBytes: 4096 });
    if (input === null)
      return NextResponse.json(
        { error: "Check the details and try again.", reason: "invoice_invalid" },
        { status: 400, headers: foundationNoStore }
      );
    const value = body.parse(input);
    service = createFoundationServiceApi();
    if (value.action === "billing") {
      const { action: _action, ...billing } = value;
      await saveInvoiceBillingByLink(billing, service);
      return NextResponse.json({ success: true }, { headers: foundationNoStore });
    }
    const { action: _action, ...payment } = value;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://verifymzansi.com";
    const { checkoutUrl } = await startInvoicePaymentByLink(payment, appUrl, service);
    return NextResponse.json({ success: true, checkoutUrl }, { headers: foundationNoStore });
  } catch (error) {
    const known = invoiceRouteRefusal(error);
    if (known && known.status < 500)
      return NextResponse.json(
        { error: known.error, reason: known.reason },
        { status: known.status, headers: foundationNoStore }
      );
    const reference = logRequestFailure(log, "Invoice payment link request failed", {
      request,
      error,
      api: service,
      action: ACTION,
    });
    return NextResponse.json(
      {
        error: "The invoice could not be updated. Reload the page before trying again.",
        reference,
      },
      { status: 503, headers: foundationNoStore }
    );
  }
}

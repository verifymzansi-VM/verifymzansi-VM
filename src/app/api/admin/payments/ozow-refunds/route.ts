import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  approveStaffRefund,
  assertStaffRefundApprovable,
  closeStaffOzowRefund,
  factForDatabase,
  readStaffRefundPayment,
  recordStaffDashboardRefund,
  requestStaffOzowRefund,
  sendOzowRefund,
} from "@/lib/foundation/ozow-refunds";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationStaffCommandError, staffCommandRefusal } from "@/lib/foundation/staff-command";
import { recordStaffRefund, refundReasonCode } from "@/lib/foundation/staff-payments";
import {
  createOzowRefundClient,
  OzowRefundNotFoundError,
  OzowRefundUnavailableError,
  ozowApiRefundsEnabled,
  ozowRefundKeyConfigured,
  type OzowRefundFact,
} from "@/lib/payments/ozow-refunds";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AdminOzowRefunds");

const uuid = z.uuid().transform((value) => value.toLowerCase());
const reason = z.string().trim().min(5).max(500);
// Part of what is left, in cents (null: the whole payment or slot), and the
// day the customer asked (a first purchase cancelled): either one sends the
// refund through api.record_staff_refund (20261125133916_staff_part_refunds.sql).
const amountCents = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .default(null);
const askedOn = z.iso.date().nullable().default(null);
// One id per refund form opening, sent again on a retry (record_staff_refund).
const requestId = uuid.nullable().default(null);
/** The request id a refund through record_staff_refund needs. */
function partRequestId(value: string | null) {
  if (!value)
    throw new FoundationStaffCommandError(422, "Reload the page and record the refund again.");
  return value;
}
const schema = z.discriminatedUnion("action", [
  // A refund the server sends to Ozow: no reference is typed.
  z.object({
    action: z.literal("refund.request"),
    paymentId: uuid,
    lineId: uuid.nullable().default(null),
    reasonCode: refundReasonCode,
    reason,
    amountCents,
    askedOn,
    requestId,
  }),
  // A refund an admin already made by hand in the Ozow dashboard.
  z.object({
    action: z.literal("refund.dashboard"),
    paymentId: uuid,
    lineId: uuid.nullable().default(null),
    reasonCode: refundReasonCode,
    reason,
    ozowRefundId: z.string().max(100),
    amountCents,
    askedOn,
    requestId,
  }),
  z.object({ action: z.literal("refund.approve"), requestId: uuid }),
  // Another staff member closes a refund through Ozow that never reached Ozow.
  z.object({ action: z.literal("refund.close"), requestId: uuid, reason }),
]);

const refundId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

/**
 * A refund id typed from the Ozow dashboard is read back from Ozow first,
 * whenever the refund key is set: it must exist, must not have failed, and
 * must be a refund of this payment's Ozow transaction for its amount (the
 * database checks the last two again). When Ozow cannot be asked, nothing is
 * recorded. Without the refund key nothing can be read: null.
 */
async function readDashboardRefund(
  value: string,
  payment: { ozow_transaction_id: string | null; amount_cents: number },
  amountCents: number | null
): Promise<OzowRefundFact | null> {
  const id = refundId.safeParse(value);
  if (!id.success) return null; // the adapter refuses it in plain words
  if (!ozowRefundKeyConfigured()) {
    log.warn("Dashboard refund recorded without the refund key to read it from Ozow");
    return null;
  }
  let fact: OzowRefundFact;
  try {
    fact = await createOzowRefundClient().get(id.data.toLowerCase());
  } catch (error) {
    if (error instanceof OzowRefundNotFoundError)
      throw new FoundationStaffCommandError(
        422,
        "Ozow has no refund with that id. Copy the refund id from the refund in the Ozow dashboard."
      );
    if (!(error instanceof OzowRefundUnavailableError)) throw error;
    throw new FoundationStaffCommandError(
      503,
      "Ozow could not be asked about this refund, so it was not recorded. Try again in a few minutes."
    );
  }
  if (["Failed", "Cancelled", "Invalid", "Error", "Returned"].includes(fact.status))
    throw new FoundationStaffCommandError(
      409,
      `Ozow reports this refund as '${fact.status.toLowerCase()}': no money went back. Do not record it.`
    );
  // A part refund (amountCents) is for the amount typed; otherwise for the
  // whole payment or slot. The database checks both again.
  if (
    fact.transactionId !== payment.ozow_transaction_id ||
    fact.amountCents !== (amountCents ?? payment.amount_cents)
  )
    throw new FoundationStaffCommandError(
      409,
      "This Ozow refund is for another payment or amount. Check the refund id in the Ozow dashboard."
    );
  return fact;
}

/**
 * POST /api/admin/payments/ozow-refunds — staff refunds through Ozow (asking
 * for one and approving one only while OZOW_API_REFUNDS_ENABLED is on; closing
 * one that never reached Ozow always), and the record of a refund made in the
 * Ozow dashboard (always). Same-origin, CSRF, rate limit and a
 * verified staff session (handleFoundationOwnerRoute); the database checks
 * the staff member, the approval rules and the payment. When the database
 * answers "approved", the server sends the refund to Ozow at once with the
 * record's own Idempotency-Key; if that send does not happen, the 10-minute
 * payment job sends it.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:ozow-refunds",
    mutate: true,
    maxBytes: 4000,
    signInMessage: "Sign in to manage refunds",
    unavailableMessage: "The refund could not be confirmed. Reload before trying again.",
    refusal: staffCommandRefusal,
    command: async (api, input) => {
      const body = schema.parse(input);
      if (body.action === "refund.dashboard") {
        // The refund right (admins, recent second factor) is checked before
        // the server asks Ozow anything with the refund key.
        const payment = await readStaffRefundPayment(api, body.paymentId, body.lineId);
        if (!payment) throw new FoundationStaffCommandError(404, "This payment was not found.");
        const ozowFact = await readDashboardRefund(body.ozowRefundId, payment, body.amountCents);
        if (body.amountCents !== null || body.askedOn !== null)
          return {
            success: true,
            data: await recordStaffRefund(api, {
              paymentId: body.paymentId,
              lineId: body.lineId,
              channel: "dashboard",
              amountCents: body.amountCents,
              reasonCode: body.reasonCode,
              reason: body.reason,
              reference: body.ozowRefundId.trim().toLowerCase(),
              ozowFact: ozowFact ? factForDatabase(ozowFact) : null,
              askedOn: body.askedOn,
              requestId: partRequestId(body.requestId),
            }),
          };
        return {
          success: true,
          data: await recordStaffDashboardRefund(api, { ...body, ozowFact }),
        };
      }
      // Recording a dashboard refund and closing a refund that never reached
      // Ozow stay open while refunds through Ozow are switched off, so no
      // record is stranded; asking for one and approving one need the switch.
      if (body.action === "refund.close")
        return {
          success: true,
          data: await closeStaffOzowRefund(api, body.requestId, body.reason),
        };
      if (body.action === "refund.request" && !ozowApiRefundsEnabled())
        throw new FoundationStaffCommandError(404, "Refunds through Ozow are not switched on.");
      if (body.action === "refund.approve") await assertStaffRefundApprovable(api, body.requestId);
      const recorded =
        body.action === "refund.request"
          ? body.amountCents !== null || body.askedOn !== null
            ? await recordStaffRefund(api, {
                paymentId: body.paymentId,
                lineId: body.lineId,
                channel: "ozow",
                amountCents: body.amountCents,
                reasonCode: body.reasonCode,
                reason: body.reason,
                reference: null,
                ozowFact: null,
                askedOn: body.askedOn,
                requestId: partRequestId(body.requestId),
              })
            : await requestStaffOzowRefund(api, body)
          : await approveStaffRefund(api, body.requestId);
      if (recorded.status !== "approved") return { success: true, data: recorded };
      // Approved: the database hands the record to one sender only, so a
      // repeated click or a concurrent approval never sends it twice.
      let sent;
      try {
        sent = await sendOzowRefund(
          createFoundationServiceApi(),
          createOzowRefundClient(),
          recorded.request_id
        );
      } catch (error) {
        log.error("Ozow refund send could not be confirmed", {
          requestId: recorded.request_id,
          error: error instanceof Error ? error.name : "unknown",
        });
        throw new FoundationStaffCommandError(
          503,
          "The refund is approved; sending it to Ozow could not be confirmed. Do not refund it again: it is sent automatically within 10 minutes. Reload to see its state."
        );
      }
      return {
        success: true,
        data: {
          ...recorded,
          status: sent.status ?? recorded.status,
          sent: sent.sent,
          answered: sent.sent && sent.answered,
        },
      };
    },
  });
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  approveStaffRefund,
  closeStaffOzowRefund,
  readStaffOzowRefunds,
  recordStaffDashboardRefund,
  requestStaffOzowRefund,
  sendOzowRefund,
} from "@/lib/foundation/ozow-refunds";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationStaffCommandError, staffCommandRefusal } from "@/lib/foundation/staff-command";
import { refundReasonCode } from "@/lib/foundation/staff-payments";
import {
  createOzowRefundClient,
  OzowRefundNotFoundError,
  OzowRefundUnavailableError,
  ozowApiRefundsEnabled,
} from "@/lib/payments/ozow-refunds";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AdminOzowRefunds");

const uuid = z.uuid().transform((value) => value.toLowerCase());
const reason = z.string().trim().min(5).max(500);
const schema = z.discriminatedUnion("action", [
  // A refund the server sends to Ozow: no reference is typed.
  z.object({
    action: z.literal("refund.request"),
    paymentId: uuid,
    lineId: uuid.nullable().default(null),
    reasonCode: refundReasonCode,
    reason,
  }),
  // A refund an admin already made by hand in the Ozow dashboard.
  z.object({
    action: z.literal("refund.dashboard"),
    paymentId: uuid,
    lineId: uuid.nullable().default(null),
    reasonCode: refundReasonCode,
    reason,
    ozowRefundId: z.string().max(100),
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
 * A refund id typed from the Ozow dashboard is read back from Ozow first: it
 * must exist and must not have failed. When Ozow cannot be asked (the reason
 * for this path), it is recorded and the 10-minute job reads it later and
 * alerts staff when Ozow's transaction or amount differs.
 */
async function checkDashboardRefund(value: string) {
  const id = refundId.safeParse(value);
  if (!id.success) return; // the adapter refuses it in plain words
  try {
    const fact = await createOzowRefundClient().get(id.data.toLowerCase());
    if (["Failed", "Cancelled", "Invalid", "Error", "Returned"].includes(fact.status))
      throw new FoundationStaffCommandError(
        409,
        `Ozow reports this refund as '${fact.status.toLowerCase()}': no money went back. Do not record it.`
      );
  } catch (error) {
    if (error instanceof OzowRefundNotFoundError)
      throw new FoundationStaffCommandError(
        422,
        "Ozow has no refund with that id. Copy the refund id from the refund in the Ozow dashboard."
      );
    if (!(error instanceof OzowRefundUnavailableError)) throw error;
    log.warn("Dashboard refund recorded without reading it back from Ozow");
  }
}

/**
 * POST /api/admin/payments/ozow-refunds — staff refunds through Ozow, only
 * while OZOW_API_REFUNDS_ENABLED is on (otherwise 404), and the record of a
 * refund made in the Ozow dashboard (always). Same-origin, CSRF, rate limit and a
 * verified staff session (handleFoundationOwnerRoute); the database checks
 * the staff member, the approval rules and the payment. When the database
 * answers "approved", the server sends the refund to Ozow at once with the
 * record's own Idempotency-Key; if that send does not happen, the 10-minute
 * payment job sends it.
 */
export async function POST(request: Request) {
  const next = request instanceof NextRequest ? request : new NextRequest(request);
  return handleFoundationOwnerRoute({
    request: next,
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
        // Staff only (payment view, admins) before the server asks Ozow
        // anything with the refund key; the command checks the refund right.
        await readStaffOzowRefunds(api, [body.paymentId]);
        await checkDashboardRefund(body.ozowRefundId);
        return { success: true, data: await recordStaffDashboardRefund(api, body) };
      }
      // Recording a dashboard refund stays open while refunds through Ozow are
      // switched off (typed references retire once Ozow refunds were used);
      // sending, approving and closing need the switch.
      if (!ozowApiRefundsEnabled())
        throw new FoundationStaffCommandError(404, "Refunds through Ozow are not switched on.");
      if (body.action === "refund.close")
        return {
          success: true,
          data: await closeStaffOzowRefund(api, body.requestId, body.reason),
        };
      const recorded =
        body.action === "refund.request"
          ? await requestStaffOzowRefund(api, body)
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

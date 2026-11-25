import type { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { FoundationStaffCommandError, staffCommandRefusal } from "@/lib/foundation/staff-command";
import {
  decideRestoredCommission,
  PARTNER_MAX_RATE_BPS,
  saveRestoredPartner,
} from "@/lib/foundation/partners";
import { assertStaffRefundApprovable } from "@/lib/foundation/ozow-refunds";
import {
  activateStaffPaidPayment,
  approveStaffPaymentRefund,
  confirmStaffBankTransfer,
  declineStaffBankTransfer,
  EXPIRED_TRANSFER_RESOLUTIONS,
  resolveStaffExpiredTransfer,
  declineStaffPaymentRefund,
  readStaffBankTransferCustomer,
  recordStaffBankTransfer,
  recordStaffPaymentRefund,
  recordStaffSlotRefund,
  refundReasonCode,
} from "@/lib/foundation/staff-payments";
import {
  invoiceTransferInput,
  issueStaffInvoice,
  recordStaffInvoiceTransfer,
  voidStaffInvoice,
} from "@/lib/foundation/customer-invoices";
import {
  approveStaffPackageInvoice,
  declineStaffPackageInvoiceRequest,
  issueStaffPackageInvoice,
} from "@/lib/foundation/package-invoices";
import {
  addLostDays,
  lostDaysAddInput,
  lostDaysPreviewInput,
  previewLostDays,
} from "@/lib/foundation/lost-days";
import {
  inviteFrontendStaffOrganisationAdmin,
  manageFrontendStaffOrganisation,
  revokeFrontendStaffOrganisationInvite,
  saveFrontendStaffOrganisation,
} from "@/lib/foundation/staff-organisation-commands";

const log = createLogger("AdminCommercial");

const reason = z.string().trim().min(5).max(500);
const uuid = z.uuid();
const values = z.record(z.string(), z.unknown()).default({});

const schema = z.discriminatedUnion("action", [
  // A refund or chargeback names Ozow's reference and a reason code; an empty
  // reference reaches the command, which refuses it with a plain message.
  z.object({
    action: z.literal("payment.reverse"),
    paymentId: uuid,
    kind: z.enum(["refunded", "chargeback"]),
    reasonCode: refundReasonCode,
    ozowReference: z.string().max(200).default(""),
    reason,
  }),
  z.object({
    action: z.literal("payment.reverse_slot"),
    lineId: uuid,
    kind: z.enum(["refunded", "chargeback"]),
    reasonCode: refundReasonCode,
    ozowReference: z.string().max(200).default(""),
    reason,
  }),
  z.object({ action: z.literal("payment.activate"), paymentId: uuid, reason }),
  z.object({ action: z.literal("payment.transfer_confirm"), transferId: uuid }),
  z.object({ action: z.literal("payment.transfer_decline"), transferId: uuid, reason }),
  // An expired transfer followed up outside the site (audited).
  z.object({
    action: z.literal("payment.transfer_resolve"),
    transferId: uuid,
    resolution: z.enum(EXPIRED_TRANSFER_RESOLUTIONS),
    reason,
  }),
  z.object({
    action: z.literal("payment.transfer_customer"),
    accountEmail: z.string().trim().min(3).max(254),
  }),
  // A cleared bank transfer recorded as a payment. An empty bank reference or
  // an unticked waiver reaches the adapter, which refuses it in plain words.
  z.object({
    action: z.literal("payment.record_transfer"),
    accountEmail: z.string().trim().min(3).max(254),
    termDays: z.union([z.literal(30), z.literal(90), z.literal(180)]),
    slots: z.number().int().min(1).max(25),
    amountCents: z.number().int().positive().max(100_000_000),
    bankReference: z.string().max(200).default(""),
    clearedOn: z.iso.date(),
    coolingOffWaiver: z.boolean(),
    reason,
  }),
  // A customer invoice (Ozow "Pay now"); the database prices and numbers it.
  z.object({
    action: z.literal("invoice.issue"),
    accountEmail: z.string().trim().min(3).max(254),
    termDays: z.union([z.literal(30), z.literal(90), z.literal(180)]),
    slots: z.number().int().min(1).max(25),
    dueDays: z.number().int().min(1).max(30),
    requestId: uuid,
    reason,
  }),
  z.object({ action: z.literal("invoice.void"), invoiceId: uuid, reason }),
  // A member's request for a Multi-listing package invoice (P4e): staff issue
  // it at the price asked for (above R50 000 a second staff member approves
  // it) or decline it; the database prices, numbers and checks it.
  z.object({
    action: z.literal("package_invoice.issue"),
    requestId: uuid,
    dueDays: z.number().int().min(1).max(30),
    reason,
  }),
  z.object({ action: z.literal("package_invoice.approve"), requestId: uuid }),
  z.object({ action: z.literal("package_invoice.decline"), requestId: uuid, reason }),
  // A cleared bank transfer to an invoice; a second staff member confirms it.
  invoiceTransferInput.extend({ action: z.literal("invoice.record_transfer") }),
  z.object({ action: z.literal("payment.refund_approve"), requestId: uuid }),
  z.object({ action: z.literal("payment.refund_decline"), requestId: uuid, reason }),
  z.object({
    action: z.literal("partner.manage"),
    userId: uuid,
    operation: z.enum(["create", "suspend", "activate", "rate"]),
    values: z
      .object({
        code: z
          .string()
          .regex(/^[A-Za-z0-9]{4,16}$/)
          .optional(),
        commissionBps: z.number().int().min(0).max(PARTNER_MAX_RATE_BPS).nullable().optional(),
        notes: z.string().max(1000).optional(),
      })
      .strict(),
    reason,
  }),
  z.object({
    action: z.literal("commission.manage"),
    commissionId: uuid,
    operation: z.enum(["approve", "mark_paid", "reverse"]),
    values: z
      .object({
        amountCents: z.number().int().min(0).optional(),
        reference: z.string().max(120).optional(),
      })
      .strict(),
    reason,
  }),
  z.object({
    action: z.literal("organisation.upsert"),
    organisationId: uuid.optional(),
    revision: z.number().int().min(1).optional(),
    values,
    reason,
  }),
  z.object({
    action: z.literal("organisation.manage"),
    organisationId: uuid,
    revision: z.number().int().min(1).optional(),
    operation: z.enum([
      "activate_trial",
      "suspend",
      "reinstate",
      "end_trial",
      "convert_paid",
      "approve_logo",
      "revoke_logo",
      "add_admin",
      "remove_admin",
      "add_programme",
      "update_programme",
      "note",
      "set_capacity",
      "upsert_showcase",
    ]),
    values,
    reason,
  }),
  z.object({
    action: z.literal("organisation.invite_admin"),
    organisationId: uuid,
    email: z.email().max(254),
    reason,
  }),
  z.object({ action: z.literal("organisation.revoke_invite"), inviteId: uuid, reason }),
  // Lost days: the member's running paid terms, then the days added to them.
  lostDaysPreviewInput,
  lostDaysAddInput,
]);

/**
 * POST /api/admin/commercial
 * Every commercial change (payments, refunds, invoices, partners,
 * organisations) runs in a SECURITY DEFINER RPC that re-checks the actor's
 * role and writes the audit row atomically.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request: request,
    log,
    action: "admin:commercial",
    mutate: true,
    maxBytes: 16000,
    signInMessage: "Sign in to manage commercial settings",
    unavailableMessage: "The change could not be confirmed. Reload before trying again.",
    refusal: staffCommandRefusal,
    command: async (api, input) => {
      const body = schema.parse(input);
      if (body.action === "payment.reverse")
        return {
          success: true,
          data: await recordStaffPaymentRefund(api, body.paymentId.toLowerCase(), body),
        };
      if (body.action === "payment.reverse_slot")
        return {
          success: true,
          data: await recordStaffSlotRefund(api, body.lineId.toLowerCase(), body),
        };
      if (body.action === "payment.activate")
        return {
          success: true,
          data: await activateStaffPaidPayment(api, body.paymentId.toLowerCase(), body.reason),
        };
      if (body.action === "payment.transfer_confirm")
        return {
          success: true,
          data: await confirmStaffBankTransfer(api, body.transferId.toLowerCase()),
        };
      if (body.action === "payment.transfer_decline")
        return {
          success: true,
          data: await declineStaffBankTransfer(api, body.transferId.toLowerCase(), body.reason),
        };
      if (body.action === "payment.transfer_resolve")
        return {
          success: true,
          data: await resolveStaffExpiredTransfer(
            api,
            body.transferId.toLowerCase(),
            body.resolution,
            body.reason
          ),
        };
      if (body.action === "payment.transfer_customer")
        return {
          success: true,
          data: await readStaffBankTransferCustomer(api, body.accountEmail),
        };
      if (body.action === "slots.lost_days_preview")
        return { success: true, data: await previewLostDays(api, body.accountEmail) };
      if (body.action === "slots.add_lost_days")
        return {
          success: true,
          data: await addLostDays(api, {
            email: body.accountEmail,
            days: body.days,
            reason: body.reason,
            requestId: body.requestId.toLowerCase(),
          }),
        };
      if (body.action === "payment.record_transfer")
        return { success: true, data: await recordStaffBankTransfer(api, body) };
      if (body.action === "invoice.issue") {
        const { action: _action, ...invoice } = body;
        return { success: true, data: await issueStaffInvoice(api, invoice) };
      }
      if (body.action === "invoice.record_transfer") {
        const { action: _action, ...transfer } = body;
        return { success: true, data: await recordStaffInvoiceTransfer(api, transfer) };
      }
      if (body.action === "invoice.void")
        return {
          success: true,
          data: await voidStaffInvoice(api, body.invoiceId.toLowerCase(), body.reason),
        };
      if (body.action === "package_invoice.issue") {
        const { action: _action, ...issue } = body;
        return { success: true, data: await issueStaffPackageInvoice(api, issue) };
      }
      if (body.action === "package_invoice.approve")
        return { success: true, data: await approveStaffPackageInvoice(api, body.requestId) };
      if (body.action === "package_invoice.decline")
        return {
          success: true,
          data: await declineStaffPackageInvoiceRequest(api, body.requestId, body.reason),
        };
      if (body.action === "payment.refund_approve") {
        // The same rules as the Ozow refunds route: a refund through Ozow is
        // never approved here while refunds through Ozow are switched off.
        await assertStaffRefundApprovable(api, body.requestId.toLowerCase());
        return {
          success: true,
          data: await approveStaffPaymentRefund(api, body.requestId.toLowerCase()),
        };
      }
      if (body.action === "payment.refund_decline")
        return {
          success: true,
          data: await declineStaffPaymentRefund(api, body.requestId.toLowerCase(), body.reason),
        };
      if (body.action === "organisation.upsert")
        return { success: true, data: await saveFrontendStaffOrganisation(api, body) };
      if (body.action === "organisation.manage")
        return { success: true, data: await manageFrontendStaffOrganisation(api, body) };
      if (body.action === "organisation.invite_admin")
        return { success: true, data: await inviteFrontendStaffOrganisationAdmin(api, body) };
      if (body.action === "organisation.revoke_invite")
        return {
          success: true,
          data: await revokeFrontendStaffOrganisationInvite(api, body.inviteId, body.reason),
        };
      if (body.action === "partner.manage") {
        const data = await saveRestoredPartner(api, {
          account_id: body.userId,
          action: body.operation === "rate" ? "set_rate" : body.operation,
          reason: body.reason,
          code: body.values.code,
          commission_bps: body.values.commissionBps ?? undefined,
          note: body.values.notes?.trim() || undefined,
        });
        return { success: true, data };
      }
      if (body.action === "commission.manage") {
        if (body.values.amountCents !== undefined)
          throw new FoundationStaffCommandError(
            422,
            "Commission amounts are fixed by the recorded payment."
          );
        const data = await decideRestoredCommission(api, {
          commission_id: body.commissionId,
          action: body.operation,
          reason: body.reason,
          ...(body.operation === "mark_paid" ? { reference: body.values.reference } : {}),
        });
        return { success: true, data };
      }
      throw new FoundationStaffCommandError(
        501,
        "This action is not yet available on the new backend."
      );
    },
  });
}

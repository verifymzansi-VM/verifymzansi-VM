import { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { FoundationStaffCommandError, staffCommandRefusal } from "@/lib/foundation/staff-command";
import { decideRestoredCommission, saveRestoredPartner } from "@/lib/foundation/partners";
import {
  activateStaffPaidPayment,
  approveStaffPaymentRefund,
  declineStaffPaymentRefund,
  recordStaffPaymentRefund,
  recordStaffSlotRefund,
  refundReasonCode,
} from "@/lib/foundation/staff-payments";
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
const programmeType = z.enum([
  "STRATEGIC_INDIVIDUAL",
  "FOUNDING_COMMERCIAL_PARTNER",
  "ENTERPRISE_CUSTOM",
]);
const trialKind = z.enum([
  "NONE",
  "PUBLIC_7_DAY",
  "PUBLIC_30_DAY",
  "STRATEGIC_INDIVIDUAL",
  "FOUNDING_COMMERCIAL_PARTNER",
  "FOUNDING_ORGANISATION",
  "SPONSORED_ORGANISATION_MEMBER",
]);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings.update"), key: z.string(), value: values, reason }),
  z.object({
    action: z.literal("plan.update"),
    planId: uuid,
    values: z
      .object({
        priceCents: z.number().int().min(100).max(100_000_000).optional(),
        compareAtCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
        slotCapacity: z.number().int().min(1).max(100_000).optional(),
        durationDays: z.number().int().min(1).max(1100).optional(),
        monthlyActivationLimit: z.number().int().min(1).max(100_000).optional(),
        promoLabel: z.string().max(30).optional(),
        active: z.boolean().optional(),
        public: z.boolean().optional(),
      })
      .strict(),
    reason,
  }),
  z.object({
    action: z.literal("programme.grant"),
    userId: uuid,
    type: programmeType,
    values: z
      .object({
        title: z.string().trim().max(160).optional(),
        durationDays: z.number().int().min(7).max(1100).optional(),
        slotCapacity: z.number().int().min(1).max(100_000).optional(),
        activationLimitTotal: z.number().int().min(1).max(100_000).optional(),
        activationsPerPeriod: z.number().int().min(1).max(100_000).optional(),
        adminLimit: z.number().int().min(1).max(50).optional(),
        priceCents: z.number().int().min(0).max(100_000_000).optional(),
        area: z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]).optional(),
        notes: z.string().max(2000).optional(),
        startsAt: z.iso.datetime().optional(),
      })
      .strict(),
    override: z.boolean().default(false),
    reason,
  }),
  z.object({
    action: z.literal("contract.manage"),
    contractId: uuid,
    operation: z.enum([
      "extend",
      "end",
      "limits",
      "notes",
      "add_member",
      "remove_member",
      "mark_paid",
    ]),
    values,
    reason,
  }),
  z.object({ action: z.literal("trial.override"), userId: uuid, kind: trialKind, reason }),
  z.object({
    action: z.literal("event.allowance"),
    userId: uuid,
    values: z
      .object({
        maxActive: z.number().int().min(1).max(10000).optional(),
        maxCreatedPer30Days: z.number().int().min(1).max(100000).optional(),
        notes: z.string().max(1000).optional(),
        remove: z.boolean().optional(),
      })
      .strict()
      .refine((v) => v.remove || (v.maxActive && v.maxCreatedPer30Days), {
        message: "Set both limits or remove the allowance",
      }),
    reason,
  }),
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
        commissionBps: z.number().int().min(0).max(5000).nullable().optional(),
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
  z.object({
    action: z.literal("trial_extension.offer"),
    targetType: z.enum(["organisation_trial", "founding_contract", "intro_trial_claim"]),
    targetId: uuid,
    days: z.number().int().min(1).max(30),
    kind: z.enum(["consent", "correction"]).default("consent"),
    reason,
  }),
  z.object({
    action: z.literal("trial_extension.decide"),
    offerId: uuid,
    approve: z.boolean(),
    reason,
  }),
  z.object({ action: z.literal("trial_extension.withdraw"), offerId: uuid, reason }),
  z.object({ action: z.literal("trial_extension.resend"), offerId: uuid }),
]);

/**
 * POST /api/admin/commercial
 * Every commercial change (settings, prices, programmes, contracts, trial
 * overrides, refunds, partners, organisations) runs in a SECURITY DEFINER RPC
 * that re-checks the actor's role and writes the audit row atomically.
 */
export async function POST(request: Request) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
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
      if (body.action === "payment.refund_approve")
        return {
          success: true,
          data: await approveStaffPaymentRefund(api, body.requestId.toLowerCase()),
        };
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

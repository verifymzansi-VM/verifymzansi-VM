import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import type { Capability } from "@/lib/auth/roles";
import { mapCommercialError } from "@/lib/commercial/errors";
import {
  COMMERCIAL_SETTING_SCHEMAS,
  clearCommercialSettingsCache,
  isCommercialSettingKey,
} from "@/lib/commercial/settings";
import { sendOrganisationAdminInviteEmail } from "@/lib/services/email";
import { sanitizeAppUrl } from "@/lib/services/email-template";

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
  z.object({
    action: z.literal("payment.reverse"),
    paymentId: uuid,
    kind: z.enum(["refunded", "chargeback"]),
    reason,
  }),
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
    values,
    reason,
  }),
  z.object({
    action: z.literal("organisation.manage"),
    organisationId: uuid,
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

type Body = z.infer<typeof schema>;

const CAPABILITY: Record<Body["action"], Capability> = {
  "settings.update": "commercial:manage",
  "plan.update": "commercial:manage",
  "programme.grant": "contracts:manage",
  "contract.manage": "contracts:manage",
  "trial.override": "trials:manage",
  "event.allowance": "contracts:manage",
  "payment.reverse": "payments:refund",
  "partner.manage": "partners:manage",
  "commission.manage": "partners:manage",
  "organisation.upsert": "organisations:manage",
  "organisation.manage": "organisations:manage",
  "organisation.invite_admin": "organisations:manage",
  "organisation.revoke_invite": "organisations:manage",
  "trial_extension.offer": "trials:manage",
  "trial_extension.decide": "trials:manage",
  "trial_extension.withdraw": "trials:manage",
  "trial_extension.resend": "trials:manage",
};

function call(body: Exclude<Body, { action: "organisation.invite_admin" }>, actor: string) {
  const db = createAdminClient();
  switch (body.action) {
    case "settings.update":
      return db.rpc("update_commercial_setting", {
        p_actor: actor,
        p_key: body.key,
        p_value: body.value,
        p_reason: body.reason,
      });
    case "plan.update":
      return db.rpc("update_plan_pricing", {
        p_actor: actor,
        p_plan_id: body.planId,
        p_values: body.values,
        p_reason: body.reason,
      });
    case "programme.grant":
      return db.rpc("grant_programme_contract", {
        p_actor: actor,
        p_user: body.userId,
        p_type: body.type,
        p_values: body.values,
        p_reason: body.reason,
        p_override: body.override,
      });
    case "contract.manage":
      return db.rpc("manage_commercial_contract", {
        p_actor: actor,
        p_contract: body.contractId,
        p_action: body.operation,
        p_values: body.values,
        p_reason: body.reason,
      });
    case "trial.override":
      return db.rpc("override_trial_entitlement", {
        p_actor: actor,
        p_user: body.userId,
        p_kind: body.kind,
        p_reason: body.reason,
      });
    case "event.allowance":
      return db.rpc("admin_set_event_allowance", {
        p_actor: actor,
        p_user: body.userId,
        p_values: body.values,
        p_reason: body.reason,
      });
    case "payment.reverse":
      return db.rpc("reverse_payment", {
        p_actor: actor,
        p_payment: body.paymentId,
        p_kind: body.kind,
        p_reason: body.reason,
      });
    case "partner.manage":
      return db.rpc("admin_manage_partner", {
        p_actor: actor,
        p_user: body.userId,
        p_action: body.operation,
        p_values: body.values,
        p_reason: body.reason,
      });
    case "commission.manage":
      return db.rpc("admin_manage_commission", {
        p_actor: actor,
        p_commission: body.commissionId,
        p_action: body.operation,
        p_values: body.values,
        p_reason: body.reason,
      });
    case "organisation.upsert":
      return db.rpc("admin_upsert_organisation", {
        p_actor: actor,
        p_id: body.organisationId ?? null,
        p_values: body.values,
        p_reason: body.reason,
      });
    case "organisation.manage":
      return db.rpc("admin_manage_organisation", {
        p_actor: actor,
        p_org: body.organisationId,
        p_action: body.operation,
        p_values: body.values,
        p_reason: body.reason,
      });
    case "organisation.revoke_invite":
      return db.rpc("admin_revoke_organisation_invite", {
        p_actor: actor,
        p_invite: body.inviteId,
        p_reason: body.reason,
      });
    case "trial_extension.offer":
      return db.rpc("admin_offer_trial_extension", {
        p_actor: actor,
        p_type: body.targetType,
        p_target: body.targetId,
        p_days: body.days,
        p_reason: body.reason,
        p_kind: body.kind,
      });
    case "trial_extension.decide":
      return db.rpc("admin_decide_trial_extension", {
        p_actor: actor,
        p_offer: body.offerId,
        p_approve: body.approve,
        p_reason: body.reason,
      });
    case "trial_extension.withdraw":
      return db.rpc("admin_withdraw_trial_extension", {
        p_actor: actor,
        p_offer: body.offerId,
        p_reason: body.reason,
      });
    case "trial_extension.resend":
      return db.rpc("admin_resend_trial_extension", { p_actor: actor, p_offer: body.offerId });
  }
}

/**
 * Sponsor administrator invitation. The single-use token is generated here,
 * only its SHA-256 hash is stored, and the raw link exists only in the email.
 * If the email cannot be sent the invitation is revoked so no unusable seat
 * stays reserved.
 */
async function inviteOrganisationAdmin(
  body: Extract<Body, { action: "organisation.invite_admin" }>,
  actor: string
) {
  const db = createAdminClient();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await db.rpc("admin_invite_organisation_admin", {
    p_actor: actor,
    p_org: body.organisationId,
    p_email: body.email,
    p_token_hash: tokenHash,
    p_reason: body.reason,
  });
  if (error) return { data: null, error };
  const invite = data as { inviteId: string; expiresAt: string; organisationName: string };
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const sent = await sendOrganisationAdminInviteEmail({
    email: body.email.trim().toLowerCase(),
    organisationName: invite.organisationName,
    acceptUrl: `${appUrl}/organisation-invite?token=${encodeURIComponent(token)}`,
    expiresAt: invite.expiresAt,
    idempotencyKey: `organisation-invite/${invite.inviteId}`,
  });
  if (!sent.success) {
    await db.rpc("admin_revoke_organisation_invite", {
      p_actor: actor,
      p_invite: invite.inviteId,
      p_reason: "Invitation email could not be delivered",
    });
    log.error("Organisation invite email failed", { inviteId: invite.inviteId });
    return {
      data: null,
      error: {
        message: "The invitation email could not be sent. Please try again.",
        code: "EMAIL",
      },
    };
  }
  return { data: { inviteId: invite.inviteId, expiresAt: invite.expiresAt }, error: null };
}

/**
 * POST /api/admin/commercial
 * Every commercial change (settings, prices, programmes, contracts, trial
 * overrides, refunds, partners, organisations) runs in a SECURITY DEFINER RPC
 * that re-checks the actor's role and writes the audit row atomically.
 */
export async function POST(request: Request) {
  const guard = await enforceAdminMutationGuard({
    request,
    logger: log,
    rateLimitAction: "admin:commercial",
  });
  if (!guard.success) return guard.response;

  const parsed = await parseAndValidateJsonRequest(request, schema, {
    invalidJsonMessage: "Invalid JSON payload",
    validationErrorMessage: "Invalid request",
    includeValidationDetails: true,
  });
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  if (!(await verifyCapabilityFromDb(guard.user, CAPABILITY[body.action]))) {
    return NextResponse.json(
      { error: "You do not have permission for this action." },
      { status: 403 }
    );
  }

  if (body.action === "settings.update") {
    if (!isCommercialSettingKey(body.key)) {
      return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
    }
    const check = COMMERCIAL_SETTING_SCHEMAS[body.key].safeParse(body.value);
    if (!check.success) {
      return NextResponse.json(
        { error: "Invalid setting value", details: check.error.issues.slice(0, 5) },
        { status: 400 }
      );
    }
  }

  const { data, error } =
    body.action === "organisation.invite_admin"
      ? await inviteOrganisationAdmin(body, guard.user.id)
      : await call(body, guard.user.id);
  if (error) {
    const mapped =
      error.code === "EMAIL"
        ? { message: error.message, status: 502 }
        : mapCommercialError(error.message);
    log.warn("Commercial change refused", { action: body.action, code: error.code });
    return NextResponse.json(
      { error: mapped?.message ?? "The change could not be applied." },
      { status: mapped?.status ?? 409 }
    );
  }

  if (body.action === "settings.update") clearCommercialSettingsCache();
  return NextResponse.json({ success: true, data: data ?? null });
}

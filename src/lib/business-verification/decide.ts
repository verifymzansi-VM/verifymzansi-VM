/**
 * Staff decisions on business verification cases. Every outcome is a staff
 * decision; the checks here only refuse decisions that lack their evidence
 * (an admin-fetched CIPC copy, a director match or confirmed representative)
 * or that would bypass the two-person rule for exceptions.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createNotification } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/services/audit";
import {
  sendBusinessVerificationEmail,
  type BusinessVerificationEmailKind,
} from "@/lib/services/email";
import { normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";

import { seenApprovalGaps, type SeenState } from "./seen";
import { publicOffice, type RegisteredOfficeView } from "./public";
import { caseOffice, FILE_RETENTION_DAYS, STICKER_TTL_DAYS } from "./service";

const log = createLogger("BusinessVerificationDecide");

type Admin = SupabaseClient;

export type DecisionAction =
  | "approve"
  | "propose_exception"
  | "confirm_exception"
  | "withdraw_exception"
  | "request_info"
  | "reject"
  | "revoke";

export type DecisionInput = {
  action: DecisionAction;
  caseId: string;
  expectedUpdatedAt: string;
  actorId: string;
  actorRole: "moderator" | "governance_controller" | "admin";
  reasonCode?: string | null;
  note?: string | null;
  checks?: { inBusiness?: boolean; ownerConfirmed?: boolean };
};

export type DecisionResult =
  { ok: true; status: string } | { ok: false; status: number; error: string; code: string };

type CaseRow = {
  id: string;
  business_id: string;
  owner_id: string;
  kind: "cipc" | "cipc_link" | "seen";
  route: "director" | "representative" | null;
  status: string;
  registration_number: string | null;
  parsed: Record<string, unknown>;
  registered_office: RegisteredOfficeView | null;
  admin_copy: AdminCopy | null;
  representative: { confirmed?: boolean; position?: string | null } | null;
  seen: Record<string, unknown> | null;
  linked_case_id: string | null;
  checks: Record<string, unknown> | null;
  updated_at: string;
};

export type AdminCopy = {
  registrationNumber: string | null;
  registeredName: string | null;
  enterpriseStatus: string | null;
  directors: Array<{ name: string; role: string | null; idHmac: string | null }>;
  registeredOffice: RegisteredOfficeView | null;
  /** The office as printed, kept so a new owner upload can be re-compared. */
  registeredOfficeLines?: string[];
  cipcReference: string | null;
  differences: Array<{ field: string; owner: string | null; cipc: string | null }>;
};

const DECISION_STAFF = new Set(["governance_controller", "admin"]);

const fail = (status: number, code: string, error: string): DecisionResult => ({
  ok: false,
  status,
  code,
  error,
});

/** Case checks without a pending exception (new evidence voids a proposal). */
export function withoutException(checks: Record<string, unknown> | null | undefined) {
  if (!checks?.exception) return checks ?? null;
  const { exception: _dropped, ...rest } = checks;
  return rest;
}

/** Why an exception can't be proposed or confirmed on this case, if it can't. */
function exceptionRefusal(row: CaseRow, evidence: Evidence): DecisionResult | null {
  if (row.kind !== "cipc") {
    return fail(
      400,
      "exception_not_allowed",
      row.kind === "seen"
        ? "Seen checks can't be approved by exception. Book a new check instead."
        : "A linked profile needs a live sticker on its source company; no exception applies."
    );
  }
  if (evidence.unwaivable.length) {
    return fail(400, "not_waivable", `An exception can't cover: ${evidence.unwaivable.join(" ")}`);
  }
  if (!evidence.missing.length) {
    return fail(409, "nothing_to_waive", "Nothing is missing. Approve the case instead.");
  }
  return null;
}

function stickerName(kind: CaseRow["kind"]) {
  return kind === "seen" ? "Seen by VerifyMzansi" : "CIPC registered";
}

function addDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** The owner's approved SA ID hash, for matching directors on the admin copy. */
async function ownerHmac(admin: Admin, ownerId: string): Promise<string | null> {
  const { data } = await admin
    .from("verification_steps")
    .select("id_number_hmac")
    .eq("user_id", ownerId)
    .eq("step_type", "id_doc")
    .eq("status", "approved")
    .maybeSingle();
  return (data?.id_number_hmac as string | null) ?? null;
}

type Evidence = {
  ready: boolean;
  missing: string[];
  /** Gaps a two-person exception may never waive. */
  unwaivable: string[];
  role: "director" | "member" | "representative" | null;
  position: string | null;
  registeredName: string | null;
};

/** What an approval would rest on, and what is still missing. */
export async function approvalEvidence(admin: Admin, row: CaseRow): Promise<Evidence> {
  const missing: string[] = [];

  if (row.kind === "cipc_link") {
    const { data: source } = await admin
      .from("business_verifications")
      .select("business_id, owner_id, status, registration_number")
      .eq("id", row.linked_case_id ?? "00000000-0000-0000-0000-000000000000")
      .maybeSingle();
    const { data: sourceBiz } = source
      ? await admin
          .from("businesses")
          .select(
            "owner_id, cipc_verified_at, cipc_expires_at, cipc_registered_name, owner_verified_role, owner_position_title"
          )
          .eq("id", source.business_id)
          .maybeSingle()
      : { data: null };
    const live =
      sourceBiz?.cipc_verified_at &&
      (!sourceBiz.cipc_expires_at || Date.parse(sourceBiz.cipc_expires_at) > Date.now());
    if (
      !source ||
      source.owner_id !== row.owner_id ||
      !live ||
      source.registration_number !== row.registration_number
    ) {
      missing.push("The linked profile no longer holds a live CIPC sticker for the same owner.");
    }
    return {
      ready: missing.length === 0,
      missing,
      unwaivable: [...missing],
      role: (sourceBiz?.owner_verified_role as Evidence["role"]) ?? null,
      position: (sourceBiz?.owner_position_title as string | null) ?? null,
      registeredName: (sourceBiz?.cipc_registered_name as string | null) ?? null,
    };
  }

  // An exception may waive only the director match and the company status.
  const unwaivable: string[] = [];
  const hard = (text: string) => {
    missing.push(text);
    unwaivable.push(text);
  };
  const copy = row.admin_copy;
  if (!copy) hard("Attach the copy you fetched from CIPC.");
  if (copy && copy.registrationNumber !== row.registration_number) {
    hard("Your CIPC copy is for a different registration number.");
  }
  if (copy && !/^in business$/i.test(copy.enterpriseStatus ?? "")) {
    missing.push("CIPC does not show the company as In Business.");
  }

  let role: Evidence["role"] = null;
  let position: string | null = null;
  if (row.route === "representative") {
    if (!row.representative?.confirmed)
      hard("Confirm the representative (work email and call-back).");
    role = "representative";
    position = row.representative?.position ?? null;
  } else if (copy) {
    const hmac = await ownerHmac(admin, row.owner_id);
    const match = hmac ? copy.directors.find((d) => d.idHmac === hmac) : undefined;
    if (!match) {
      missing.push("The owner's ID is not on your CIPC copy's director list.");
    } else {
      role = /member/i.test(match.role ?? "") ? "member" : "director";
      position = match.role ?? (role === "member" ? "Member" : "Director");
    }
  }

  const { data: conflict } = await admin
    .from("businesses")
    .select("id")
    .eq("cipc_registration_number", row.registration_number ?? "")
    .not("cipc_verified_at", "is", null)
    .neq("owner_id", row.owner_id)
    .limit(1);
  if (conflict?.length) hard("Another owner already holds this company's sticker.");

  return {
    ready: missing.length === 0,
    missing,
    unwaivable,
    role,
    position,
    registeredName: copy?.registeredName ?? null,
  };
}

/** In-app notice and email to the owner. Failures are logged, never thrown. */
export async function notifyOwner(
  admin: Admin,
  row: Pick<CaseRow, "id" | "owner_id" | "business_id" | "kind">,
  kind: BusinessVerificationEmailKind,
  note: string | null
) {
  try {
    const [{ data: biz }, { data: profile }, userRes] = await Promise.all([
      admin.from("businesses").select("business_name").eq("id", row.business_id).maybeSingle(),
      admin
        .from("account_profiles")
        .select("display_name")
        .eq("user_id", row.owner_id)
        .maybeSingle(),
      admin.auth.admin.getUserById(row.owner_id),
    ]);
    const businessName = (biz?.business_name as string) ?? "your business";
    const sticker = stickerName(row.kind);
    const title = {
      approved: `${sticker} sticker approved`,
      info_requested: "We need something from you",
      message: "Message about your business verification",
      rejected: `${sticker} not approved`,
      revoked: `${sticker} sticker removed`,
    }[kind];
    await createNotification({
      userId: row.owner_id,
      type:
        kind === "approved"
          ? "success"
          : kind === "info_requested"
            ? "warning"
            : kind === "message"
              ? "info"
              : "error",
      title,
      message: note ? `${businessName}: ${note}`.slice(0, 300) : businessName,
      href: `/dashboard/businesses/${row.business_id}/verification`,
    });
    const email = userRes.data.user?.email;
    if (email) {
      await sendBusinessVerificationEmail({
        email,
        accountName: (profile?.display_name as string) || "there",
        businessName,
        businessId: row.business_id,
        sticker,
        kind,
        note,
      });
    }
  } catch (error) {
    log.error("Owner notification failed", {
      caseId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Compare-and-set on the case version the reviewer looked at. */
async function updateCase(
  admin: Admin,
  row: CaseRow,
  expected: string,
  patch: Record<string, unknown>
) {
  const { data, error } = await admin
    .from("business_verifications")
    .update(patch)
    .eq("id", row.id)
    .eq("updated_at", expected)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

async function scheduleFilePurge(admin: Admin, caseId: string) {
  const { error } = await admin
    .from("business_verification_files")
    .update({ purge_after: addDays(FILE_RETENTION_DAYS) })
    .eq("case_id", caseId)
    .is("purge_after", null);
  if (error) log.error("Could not schedule file purge", { caseId, error: error.message });
}

/**
 * Other profiles of the same owner that joined this company's sticker through
 * an approved link (branches, brands). They share the company's sticker, so
 * they renew and lose it together with the source.
 */
async function linkedProfiles(admin: Admin, row: CaseRow): Promise<string[]> {
  if (row.kind !== "cipc" || !row.registration_number) return [];
  const { data: sameCompany, error } = await admin
    .from("businesses")
    .select("id")
    .eq("owner_id", row.owner_id)
    .eq("cipc_registration_number", row.registration_number)
    .neq("id", row.business_id);
  if (error) throw new Error(error.message);
  const ids = (sameCompany ?? []).map((b) => b.id as string);
  if (!ids.length) return [];
  const { data: links, error: linkError } = await admin
    .from("business_verifications")
    .select("business_id")
    .in("business_id", ids)
    .eq("kind", "cipc_link")
    .eq("status", "approved");
  if (linkError) throw new Error(linkError.message);
  return [...new Set((links ?? []).map((l) => l.business_id as string))];
}

async function grantSticker(admin: Admin, row: CaseRow, evidence: Evidence, expiresAt: string) {
  const now = new Date().toISOString();
  // The full office comes from the case (a link follows its source company's
  // case); businesses only ever store the public view of it.
  let office = caseOffice(row);
  let stickerExpiry = expiresAt;
  if (row.kind === "cipc_link") {
    const { data: source } = await admin
      .from("business_verifications")
      .select("business_id, registered_office, admin_copy")
      .eq("id", row.linked_case_id ?? "00000000-0000-0000-0000-000000000000")
      .maybeSingle();
    office = source ? caseOffice(source as Parameters<typeof caseOffice>[0]) : null;
    if (source) {
      const { data: srcBiz } = await admin
        .from("businesses")
        .select("cipc_expires_at")
        .eq("id", source.business_id)
        .maybeSingle();
      // A linked profile shares the source company's renewal date.
      stickerExpiry = (srcBiz?.cipc_expires_at as string | null) ?? expiresAt;
    }
  }

  // A renewal carries the company's linked profiles to the new expiry date.
  const linked = await linkedProfiles(admin, row);
  const { data: flags, error: flagError } = await admin
    .from("businesses")
    .select("id, show_full_registered_office")
    .in("id", [row.business_id, ...linked]);
  if (flagError) throw new Error(flagError.message);
  const showFull = new Map(
    (flags ?? []).map((b) => [b.id as string, b.show_full_registered_office === true])
  );

  const { error } = await admin
    .from("businesses")
    .update({
      cipc_verified_at: now,
      cipc_expires_at: stickerExpiry,
      cipc_registration_number: row.registration_number,
      cipc_registered_name: evidence.registeredName,
      cipc_registered_office: publicOffice(office, showFull.get(row.business_id) ?? false),
      owner_verified_role: evidence.role,
      owner_position_title: evidence.position?.slice(0, 40) ?? null,
    })
    .eq("id", row.business_id)
    .eq("owner_id", row.owner_id);
  if (error) throw new Error(error.message);
  if (row.kind === "cipc_link" && stickerExpiry !== expiresAt) {
    await admin
      .from("business_verifications")
      .update({ expires_at: stickerExpiry })
      .eq("id", row.id);
  }

  for (const id of linked) {
    const { error: linkError } = await admin
      .from("businesses")
      .update({
        cipc_expires_at: expiresAt,
        cipc_registered_office: publicOffice(office, showFull.get(id) ?? false),
      })
      .eq("id", id)
      .eq("owner_id", row.owner_id);
    if (linkError) log.error("Linked profile renewal failed", { id, error: linkError.message });
  }
  if (linked.length) {
    const { error: caseError } = await admin
      .from("business_verifications")
      .update({ expires_at: expiresAt })
      .in("business_id", linked)
      .eq("kind", "cipc_link")
      .eq("status", "approved");
    if (caseError) log.error("Linked case renewal failed", { error: caseError.message });
  }
}

/**
 * Claim the approval on the case first (compare-and-set), then grant the
 * sticker. If granting fails the case is returned to the queue, so a sticker
 * never exists without an approved case and a lost race grants nothing.
 */
async function approveThenGrant(
  admin: Admin,
  row: CaseRow,
  input: DecisionInput,
  evidence: Evidence,
  patch: Record<string, unknown>
): Promise<boolean | "held_by_other_owner"> {
  const decidedAt = new Date().toISOString();
  const expiresAt = addDays(STICKER_TTL_DAYS);
  const ok = await updateCase(admin, row, input.expectedUpdatedAt, {
    ...patch,
    status: "approved",
    reviewed_by: input.actorId,
    decided_at: decidedAt,
    expires_at: expiresAt,
  });
  if (!ok) return false;
  try {
    await grantSticker(admin, row, evidence, expiresAt);
  } catch (error) {
    await admin
      .from("business_verifications")
      .update({ status: "pending", reviewed_by: null, decided_at: null, expires_at: null })
      .eq("id", row.id);
    // The database allows one owner per company (one_cipc_holder_per_company).
    if (error instanceof Error && error.message.includes("cipc_held_by_other_owner")) {
      return "held_by_other_owner";
    }
    throw error;
  }
  if (row.kind === "cipc") {
    // A renewal supersedes the previous approval, so only the live case can
    // later be revoked (revoking an old case must not wipe the renewal).
    const { error: supersedeError } = await admin
      .from("business_verifications")
      .update({ status: "expired", reason_code: "renewed" })
      .eq("business_id", row.business_id)
      .eq("kind", "cipc")
      .eq("status", "approved")
      .neq("id", row.id);
    if (supersedeError)
      log.error("Previous approval not superseded", { error: supersedeError.message });
  }
  await scheduleFilePurge(admin, row.id);
  return true;
}

/** Approve a Seen case: case first (compare-and-set), then the sticker. */
async function approveSeen(admin: Admin, row: CaseRow, input: DecisionInput, note: string | null) {
  const expiresAt = addDays(STICKER_TTL_DAYS);
  const ok = await updateCase(admin, row, input.expectedUpdatedAt, {
    status: "approved",
    reviewed_by: input.actorId,
    decided_at: new Date().toISOString(),
    expires_at: expiresAt,
    review_note: note,
  });
  if (!ok) return false;
  const seen = row.seen as SeenState;
  const { data: biz } = await admin
    .from("businesses")
    .select("location_city, location_province")
    .eq("id", row.business_id)
    .maybeSingle();
  // The town the verifier typed is public, so it must be a place we know.
  const province = normalizeProvinceName(String(biz?.location_province ?? ""));
  const visitedCity =
    seen.report?.city && province ? resolveCityName(province, seen.report.city) : null;
  const { error } = await admin
    .from("businesses")
    .update({
      seen_verified_at: new Date().toISOString(),
      seen_expires_at: expiresAt,
      seen_method: seen.method,
      // Only the city is public; the visited address stays in the case.
      seen_city:
        seen.method === "visit"
          ? (visitedCity ?? (biz?.location_city as string | null) ?? null)
          : null,
    })
    .eq("id", row.business_id)
    .eq("owner_id", row.owner_id);
  if (error) {
    await admin
      .from("business_verifications")
      .update({ status: "pending", reviewed_by: null, decided_at: null, expires_at: null })
      .eq("id", row.id);
    throw new Error(error.message);
  }
  await scheduleFilePurge(admin, row.id);
  return true;
}

export async function decideBusinessVerification(
  admin: Admin,
  input: DecisionInput
): Promise<DecisionResult> {
  const { data, error } = await admin
    .from("business_verifications")
    .select(
      "id, business_id, owner_id, kind, route, status, registration_number, parsed, registered_office, admin_copy, representative, seen, linked_case_id, checks, updated_at"
    )
    .eq("id", input.caseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as CaseRow | null;
  if (!row) return fail(404, "not_found", "Case not found");
  if (row.owner_id === input.actorId)
    return fail(403, "not_independent", "You can't review your own business.");
  if (Date.parse(row.updated_at) !== Date.parse(input.expectedUpdatedAt)) {
    return fail(
      409,
      "case_changed",
      "This case changed while you were reviewing it. Reload and check again."
    );
  }

  const note = input.note?.trim() || null;
  const open = row.status === "pending" || row.status === "info_requested";
  const exception = (row.checks?.exception ?? null) as {
    proposedBy?: string;
    reason?: string;
  } | null;

  switch (input.action) {
    case "request_info": {
      if (!open) return fail(409, "case_closed", "This case is closed.");
      if (!note) return fail(400, "note_required", "Write what you need from the owner.");
      // New evidence will come back, so any proposed exception lapses.
      const patch = { status: "info_requested", checks: withoutException(row.checks) };
      if (!(await updateCase(admin, row, input.expectedUpdatedAt, patch))) {
        return fail(409, "case_changed", "This case changed. Reload and check again.");
      }
      await admin.from("business_verification_messages").insert({
        case_id: row.id,
        author_id: input.actorId,
        author_role: "staff",
        body: note,
      });
      await notifyOwner(admin, row, "info_requested", note);
      break;
    }

    case "reject": {
      if (!open) return fail(409, "case_closed", "This case is closed.");
      if (!input.reasonCode || !note)
        return fail(400, "reason_required", "Choose a reason and explain it to the owner.");
      const ok = await updateCase(admin, row, input.expectedUpdatedAt, {
        status: "rejected",
        reason_code: input.reasonCode,
        review_note: note,
        reviewed_by: input.actorId,
        decided_at: new Date().toISOString(),
      });
      if (!ok) return fail(409, "case_changed", "This case changed. Reload and check again.");
      await scheduleFilePurge(admin, row.id);
      await notifyOwner(admin, row, "rejected", note);
      break;
    }

    case "approve": {
      if (row.status !== "pending")
        return fail(409, "case_not_pending", "Only cases waiting on staff can be approved.");
      if (row.kind === "seen") {
        const gaps = seenApprovalGaps(row.seen as SeenState | null, input.actorId);
        if (gaps.length) return fail(400, "evidence_missing", gaps.join(" "));
        const ok = await approveSeen(admin, row, input, note);
        if (!ok) return fail(409, "case_changed", "This case changed. Reload and check again.");
        await notifyOwner(admin, row, "approved", null);
        break;
      }
      if (row.kind === "cipc" && (!input.checks?.inBusiness || !input.checks?.ownerConfirmed)) {
        return fail(
          400,
          "checks_required",
          "Tick both checks to confirm what you verified on CIPC."
        );
      }
      const evidence = await approvalEvidence(admin, row);
      if (!evidence.ready) {
        return fail(400, "evidence_missing", evidence.missing.join(" "));
      }
      const ok = await approveThenGrant(admin, row, input, evidence, {
        review_note: note,
        checks: {
          ...(row.checks ?? {}),
          inBusiness: true,
          ownerConfirmed: true,
          approvedBy: input.actorId,
        },
      });
      if (ok === "held_by_other_owner") {
        return fail(
          409,
          "conflict_other_owner",
          "Another owner already holds this company's sticker."
        );
      }
      if (!ok) return fail(409, "case_changed", "This case changed. Reload and check again.");
      await notifyOwner(admin, row, "approved", null);
      break;
    }

    case "propose_exception": {
      if (row.status !== "pending")
        return fail(409, "case_not_pending", "Only cases waiting on staff can be approved.");
      if (!note || note.length < 10)
        return fail(400, "reason_required", "Explain why this should be approved anyway.");
      const refused = exceptionRefusal(row, await approvalEvidence(admin, row));
      if (refused) return refused;
      if (exception?.proposedBy)
        return fail(
          409,
          "exception_pending",
          "An exception is already waiting for a second reviewer."
        );
      const ok = await updateCase(admin, row, input.expectedUpdatedAt, {
        checks: {
          ...(row.checks ?? {}),
          exception: { proposedBy: input.actorId, reason: note, at: new Date().toISOString() },
        },
      });
      if (!ok) return fail(409, "case_changed", "This case changed. Reload and check again.");
      break;
    }

    case "confirm_exception": {
      if (!DECISION_STAFF.has(input.actorRole)) {
        return fail(
          403,
          "forbidden",
          "Only a governance controller or admin can confirm an exception."
        );
      }
      if (row.status !== "pending" || !exception?.proposedBy) {
        return fail(409, "no_exception", "There is no exception waiting for confirmation.");
      }
      if (exception.proposedBy === input.actorId) {
        return fail(403, "not_independent", "A different reviewer must confirm your exception.");
      }
      const evidence = await approvalEvidence(admin, row);
      const refused = exceptionRefusal(row, evidence);
      if (refused) return refused;
      const ok = await approveThenGrant(
        admin,
        row,
        input,
        {
          ...evidence,
          role: evidence.role ?? (row.route === "representative" ? "representative" : "director"),
        },
        {
          review_note: exception.reason ?? note,
          checks: {
            ...(row.checks ?? {}),
            exception: { ...exception, confirmedBy: input.actorId, missing: evidence.missing },
          },
        }
      );
      if (ok === "held_by_other_owner") {
        return fail(
          409,
          "conflict_other_owner",
          "Another owner already holds this company's sticker."
        );
      }
      if (!ok) return fail(409, "case_changed", "This case changed. Reload and check again.");
      await notifyOwner(admin, row, "approved", null);
      break;
    }

    case "withdraw_exception": {
      if (!exception?.proposedBy) {
        return fail(409, "no_exception", "There is no exception to withdraw.");
      }
      if (exception.proposedBy !== input.actorId && !DECISION_STAFF.has(input.actorRole)) {
        return fail(403, "forbidden", "Only the proposer or senior staff can withdraw it.");
      }
      const ok = await updateCase(admin, row, input.expectedUpdatedAt, {
        checks: withoutException(row.checks),
      });
      if (!ok) return fail(409, "case_changed", "This case changed. Reload and check again.");
      break;
    }

    case "revoke": {
      if (!DECISION_STAFF.has(input.actorRole)) {
        return fail(
          403,
          "forbidden",
          "Only a governance controller or admin can remove a sticker."
        );
      }
      if (row.status !== "approved")
        return fail(409, "not_approved", "Only approved stickers can be removed.");
      if (!input.reasonCode || !note)
        return fail(400, "reason_required", "Choose a reason and explain it to the owner.");
      const ok = await updateCase(admin, row, input.expectedUpdatedAt, {
        status: "revoked",
        reason_code: input.reasonCode,
        review_note: note,
        reviewed_by: input.actorId,
        decided_at: new Date().toISOString(),
      });
      if (!ok) return fail(409, "case_changed", "This case changed. Reload and check again.");
      const clear =
        row.kind === "seen"
          ? { seen_verified_at: null, seen_expires_at: null, seen_method: null, seen_city: null }
          : {
              cipc_verified_at: null,
              cipc_expires_at: null,
              cipc_registration_number: null,
              cipc_registered_name: null,
              cipc_registered_office: null,
              show_full_registered_office: false,
              owner_verified_role: null,
              owner_position_title: null,
            };
      // Removing a company's sticker also removes it from profiles linked to it.
      const linked = row.kind === "seen" ? [] : await linkedProfiles(admin, row);
      const { error: clearError } = await admin
        .from("businesses")
        .update(clear)
        .in("id", [row.business_id, ...linked]);
      if (clearError) {
        // Never leave a revoked case behind a sticker that is still public.
        await admin
          .from("business_verifications")
          .update({ status: "approved", reason_code: null, reviewed_by: null })
          .eq("id", row.id);
        throw new Error(clearError.message);
      }
      if (linked.length) {
        const { error: linkError } = await admin
          .from("business_verifications")
          .update({
            status: "revoked",
            reason_code: "source_revoked",
            review_note: note,
            reviewed_by: input.actorId,
            decided_at: new Date().toISOString(),
          })
          .in("business_id", linked)
          .eq("kind", "cipc_link")
          .eq("status", "approved");
        if (linkError) log.error("Linked cases not revoked", { error: linkError.message });
      }
      await notifyOwner(admin, row, "revoked", note);
      break;
    }
  }

  await logAuditEvent({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: `business_verification_${input.action}`,
    targetType: "business",
    targetId: row.business_id,
    area: "MZANSI_BUSINESS",
    metadata: { caseId: row.id, kind: row.kind, reasonCode: input.reasonCode ?? null },
    reason: note ?? undefined,
  });

  const status =
    input.action === "request_info"
      ? "info_requested"
      : input.action === "propose_exception" || input.action === "withdraw_exception"
        ? "pending"
        : input.action === "reject"
          ? "rejected"
          : input.action === "revoke"
            ? "revoked"
            : "approved";
  return { ok: true, status };
}

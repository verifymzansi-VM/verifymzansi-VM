/**
 * What a business verification approval would rest on, for the staff case
 * view. The source backend's decision function was removed with the retired
 * backend; staff decisions run through the live backend's review commands.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RegisteredOfficeView } from "./public";

type Admin = SupabaseClient;

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
  /** The owner asked to use the registered office as the business address. */
  apply_office_to_profile?: boolean;
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

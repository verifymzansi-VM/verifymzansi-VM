import "server-only";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/require-staff";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import {
  AuthorityRequestRefused,
  readIdentityDisclosure,
} from "@/lib/foundation/identity-disclosures";
import { AUTHORITY_REQUESTS_PATH } from "@/lib/admin/authority-requests";

/**
 * The record of an open authority request for the page (`view`) or the
 * printed sheet (`print`). The database logs the look before it answers. A
 * record that closed, or that another staff member opened, sends the screen
 * back to Authority requests; an expired authenticator code to the two-step
 * check, returning here.
 */
export async function loadDisclosureRecord(id: string, purpose: "view" | "print") {
  const staff = await requireStaff("identity:disclose");
  if (!z.uuid().safeParse(id).success) notFound();
  const path = `${AUTHORITY_REQUESTS_PATH}/${id}${purpose === "print" ? "/sheet" : ""}`;
  try {
    const { api } = await readFoundationServerSession();
    return await readIdentityDisclosure(
      api,
      createFoundationServiceApi(),
      staff.user.id,
      id,
      purpose
    );
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step?confirm=1", path));
    if (error instanceof AuthorityRequestRefused) {
      if (error.reason === "disclosure_closed") redirect(AUTHORITY_REQUESTS_PATH);
      if (error.reason === "disclosure_unavailable") notFound();
    }
    throw error;
  }
}

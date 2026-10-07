import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type ContentTable = "listings" | "businesses" | "promotions";

export type OwnedDeleteResult =
  { ok: true } | { ok: false; reason: "not_deletable" | "legal_hold" | "error"; message: string };

/**
 * Deletes the caller's own post with the service client. Owners can't delete
 * through the database API (so media cleanup and the audit log always run);
 * the same state rules apply here: events only as drafts or rejected, and no
 * post that is suspended or flagged (it is evidence). The database refuses
 * any delete while the owner is on legal hold (guard_content_delete).
 */
export async function deleteOwnedContent(
  table: ContentTable,
  id: string,
  ownerColumn: string,
  ownerId: string
): Promise<OwnedDeleteResult> {
  let query = createAdminClient().from(table).delete().eq("id", id).eq(ownerColumn, ownerId);
  query =
    table === "promotions"
      ? query.in("status", ["draft", "rejected"])
      : query.not("status", "in", "(suspended,flagged_for_review)");
  const { data, error } = await query.select("id");
  if (error) {
    if (error.message.includes("content_under_legal_hold")) {
      return {
        ok: false,
        reason: "legal_hold",
        message: "This post can't be deleted while your account is under a legal hold.",
      };
    }
    return { ok: false, reason: "error", message: error.message };
  }
  if (!data?.length) {
    return {
      ok: false,
      reason: "not_deletable",
      message: "This post cannot be deleted in its current state",
    };
  }
  return { ok: true };
}

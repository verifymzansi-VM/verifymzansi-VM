import type { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { uuidSchema } from "@/lib/validations/shared";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { isAcceptedPrivacyExportDatasetSet } from "@/lib/foundation/privacy-export-datasets";
import { privacyRevision } from "@/lib/foundation/privacy-requests";
import { isStaffSecondFactorRefusal } from "@/lib/foundation/error-reasons";
import { FoundationStaffCommandError, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("DSARExport");

const exportSchema = z.object({ requestId: uuidSchema });

/** Every refusal of this route says that nothing was exported. */
const NOTHING = {
  invalid: "Check the request and try again. Nothing was exported.",
  protection:
    "Export protection is temporarily unavailable or the limit has been reached. Nothing was exported.",
  mfa: "Verify your authenticator again. Nothing was exported.",
  forbidden:
    "Another staff member with data request access must export this request. Nothing was exported.",
  stale:
    "The request changed, or can no longer be exported: exports are possible while the request is open, or shortly after it is completed (until it is closed out). Reload it. Nothing was exported.",
  changed:
    "The member's records changed while the export was prepared. Nothing was exported. Start the export again.",
  tooLarge: "The export is too large for a direct download. Nothing was exported.",
  limit: "This request has been exported too often. Try again later. Nothing was exported.",
  unavailable: "The data export could not be confirmed. Nothing was exported.",
};
/** After the confirmation may have been committed: the member may have been
 * told and the export recorded, so this is not a refusal. */
const UNCERTAIN =
  "The export may have been recorded. Check the request history before trying again.";
/** A Postgres error code: the database answered and rolled the call back. */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** The database's "refused" answer: only the refusal was recorded. */
const refusedAnswer = z.object({ refused: z.enum(["too_large", "changed"]) });
type DatabaseError = { code?: string; message?: string };

/** The refusal for a database error code or a "refused" answer. */
function definiteRefusal(
  error: DatabaseError | { refused: "too_large" | "changed" }
): FoundationStaffCommandError {
  if ("refused" in error)
    return error.refused === "too_large"
      ? new FoundationStaffCommandError(413, NOTHING.tooLarge)
      : new FoundationStaffCommandError(409, NOTHING.changed);
  switch (error.code) {
    case "42501":
      return isStaffSecondFactorRefusal(error)
        ? new FoundationStaffCommandError(403, NOTHING.mfa, true)
        : new FoundationStaffCommandError(403, NOTHING.forbidden);
    case "PT409":
      return new FoundationStaffCommandError(409, NOTHING.stale);
    case "PT413":
      return new FoundationStaffCommandError(413, NOTHING.tooLarge);
    case "PT429":
      return new FoundationStaffCommandError(429, NOTHING.limit);
    default:
      return new FoundationStaffCommandError(503, NOTHING.unavailable);
  }
}

/**
 * POST /api/admin/dsar/export  { requestId }
 *
 * Build the complete export of a data subject's records as a download.
 * Needs dsar:manage, a second factor verified in the last 15 minutes, and a
 * verified requester identity. Nothing is stored: the file goes straight to
 * the staff member, who sends it to the requester.
 *
 * The database first prepares the export and answers only its dataset names
 * (no personal data); this route checks them (exactly the datasets in
 * privacy-export-datasets.ts). Only the confirmation returns the data, after
 * the database checked it is unchanged, in the same transaction that records
 * the export and tells the member. A refused export is never confirmed, so no
 * data leaves the database and the member hears nothing of it. Every refusal
 * says "Nothing was exported"; a failure after the confirmation may have been
 * committed says so instead.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute<{ request_id: string }>({
    request: request,
    log,
    action: "admin:dsar:export:local",
    mutate: true,
    requireCaller: true,
    unavailableMessage: "The data export could not be confirmed. Nothing was exported.",
    signInMessage: "Sign in to review data requests",
    refusal: staffCommandRefusal,
    responseHeaders: (result) => ({
      "Content-Disposition": `attachment; filename="dsar-export-${result.request_id.slice(0, 8)}.json"`,
      "X-Content-Type-Options": "nosniff",
    }),
    command: async (api, body, caller) => {
      if (!caller) throw new Error("Verified staff caller required");
      const input = exportSchema.extend({ revision: privacyRevision }).strict().safeParse(body);
      if (!input.success) throw new FoundationStaffCommandError(422, NOTHING.invalid);
      const { requestId, revision } = input.data;
      const rl = await checkSensitiveActionRateLimit(caller.accountId, "admin:dsar:export");
      if (rl.degraded || rl.limited)
        throw new FoundationStaffCommandError(rl.degraded ? 503 : 429, NOTHING.protection);
      const date = z.iso.datetime({ offset: true });
      const header = {
        request_id: z.literal(requestId),
        reference: z.literal(`DSAR-${requestId.slice(0, 8).toUpperCase()}`),
        request_type: z.literal("access"),
        received_at: date,
        due_by: date,
        account_found: z.boolean(),
      };
      /** Exactly the reviewed datasets (none missing, renamed or extra), or
       * none when no account matches the request. */
      const reviewed = (found: boolean, names: readonly string[]) =>
        found ? isAcceptedPrivacyExportDatasetSet(names) : names.length === 0;

      // 1. Prepare: the dataset names only. No personal data leaves the
      // database and the member is told nothing; anything that goes wrong
      // here means nothing was exported.
      let prepared: { data: unknown; error: DatabaseError | null };
      try {
        prepared = await api.rpc(
          "prepare_frontend_privacy_export",
          { p_case: requestId, p_revision: revision },
          { get: false }
        );
      } catch {
        throw new FoundationStaffCommandError(503, NOTHING.unavailable);
      }
      if (prepared.error) throw definiteRefusal(prepared.error);
      const preparedRefusal = refusedAnswer.safeParse(prepared.data);
      if (preparedRefusal.success) throw definiteRefusal(preparedRefusal.data);
      const plan = z
        .strictObject({
          ...header,
          export_id: z.uuid(),
          datasets: z.array(z.string().regex(/^[a-z_]{1,40}$/)).max(100),
        })
        .refine((v) => reviewed(v.account_found, v.datasets))
        .safeParse(prepared.data);
      if (!plan.success) throw new FoundationStaffCommandError(503, NOTHING.unavailable);

      // 2. Confirm: the database builds the same export again, and only if it
      // is unchanged records it, tells the member and returns the data, in one
      // transaction. A database refusal (an SQL error code, or a "refused"
      // answer) rolled that back or recorded only the refusal: nothing was
      // exported. Any other failure may come after the database committed.
      let confirmed: { data: unknown; error: DatabaseError | null };
      try {
        confirmed = await api.rpc(
          "confirm_frontend_privacy_export",
          { p_case: requestId, p_revision: revision, p_export: plan.data.export_id },
          { get: false }
        );
      } catch {
        throw new FoundationStaffCommandError(502, UNCERTAIN);
      }
      if (confirmed.error) {
        if (!SQLSTATE.test(confirmed.error.code ?? ""))
          throw new FoundationStaffCommandError(502, UNCERTAIN);
        throw definiteRefusal(confirmed.error);
      }
      const confirmedRefusal = refusedAnswer.safeParse(confirmed.data);
      if (confirmedRefusal.success) throw definiteRefusal(confirmedRefusal.data);
      // Own keys of the raw answer, so that a dataset named __proto__ (which
      // a parser may drop or treat as the prototype) cannot pass unseen.
      const raw = confirmed.data as { datasets?: unknown } | null;
      const names =
        raw && typeof raw === "object" && raw.datasets && typeof raw.datasets === "object"
          ? Object.getOwnPropertyNames(raw.datasets)
          : null;
      const parsed = z
        .strictObject({
          ...header,
          export_id: z.literal(plan.data.export_id),
          generated_at: date,
          datasets: z.record(
            z.string().regex(/^[a-z_]{1,40}$/),
            z.array(z.record(z.string(), z.unknown())).max(2500)
          ),
        })
        .safeParse(confirmed.data);
      if (
        !names ||
        names.includes("__proto__") ||
        !parsed.success ||
        !reviewed(parsed.data.account_found, names) ||
        Object.keys(parsed.data.datasets).length !== names.length
      )
        throw new FoundationStaffCommandError(502, UNCERTAIN);
      const { export_id: _exportId, ...result } = parsed.data;
      return {
        ...result,
        scope:
          "Account records in the listed datasets. Raw identity evidence, credentials, internal storage and provider data, and counterpart contact details are excluded.",
      };
    },
  });
}

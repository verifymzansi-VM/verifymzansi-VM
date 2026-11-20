import type { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { uuidSchema } from "@/lib/validations/shared";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { isAcceptedPrivacyExportDatasetSet } from "@/lib/foundation/privacy-export-datasets";
import { privacyRevision } from "@/lib/foundation/privacy-requests";
import { isStaffSecondFactorRefusal } from "@/lib/foundation/error-reasons";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "@/lib/foundation/staff-command";

const log = createLogger("DSARExport");

const exportSchema = z.object({ requestId: uuidSchema });

/**
 * POST /api/admin/dsar/export  { requestId }
 *
 * Build the complete export of a data subject's records as a download.
 * Needs dsar:manage, a second factor verified in the last 15 minutes, and a
 * verified requester identity. Nothing is stored: the file goes straight to
 * the staff member, who sends it to the requester.
 *
 * The database first prepares the export and answers only its dataset names,
 * row counts and digest (no personal data); this route checks the names
 * (exactly the datasets in privacy-export-datasets.ts). Only the confirmation
 * returns the data, in the same transaction that records the export and tells
 * the requester, once. A refused export is never confirmed, so no data leaves
 * the database and the requester hears nothing of it.
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
      const input = exportSchema.extend({ revision: privacyRevision }).strict().parse(body);
      const rl = await checkSensitiveActionRateLimit(caller.accountId, "admin:dsar:export");
      if (rl.degraded || rl.limited)
        throw new FoundationStaffCommandError(
          rl.degraded ? 503 : 429,
          "Export protection is temporarily unavailable or the limit has been reached."
        );
      // 1. Prepare: dataset names, row counts and a digest. No personal data
      // and nothing told to the member yet.
      const prepared = await api.rpc(
        "prepare_frontend_privacy_export",
        { p_case: input.requestId, p_revision: input.revision },
        { get: false }
      );
      if (prepared.error?.code === "PT413")
        throw new FoundationStaffCommandError(
          413,
          "The export is too large for a direct download. Nothing was exported."
        );
      if (prepared.error?.code === "PT429")
        throw new FoundationStaffCommandError(
          429,
          "This request has been exported too often in the last hour. Nothing was exported."
        );
      const date = z.iso.datetime({ offset: true });
      const header = {
        request_id: z.literal(input.requestId),
        reference: z.literal(`DSAR-${input.requestId.slice(0, 8).toUpperCase()}`),
        request_type: z.literal("access"),
        received_at: date,
        due_by: date,
        account_found: z.boolean(),
      };
      /** Exactly the reviewed datasets (none missing, renamed or extra), or
       * none when no account matches the request. */
      const reviewedNames = (v: { account_found: boolean; datasets: object }) =>
        v.account_found
          ? isAcceptedPrivacyExportDatasetSet(Object.keys(v.datasets))
          : Object.keys(v.datasets).length === 0;
      const plan = await settleStaffCommand(
        Promise.resolve(prepared),
        z
          .strictObject({
            ...header,
            export_id: z.uuid(),
            digest: z.string().regex(/^[0-9a-f]{64}$/),
            datasets: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.int().min(0).max(2500)),
          })
          .refine(reviewedNames)
      );
      // 2. Confirm: the database builds the same export again (refusing it if
      // it changed), records it, tells the member once and returns the data,
      // all in one transaction. If it fails, nothing is handed over.
      const confirmed = await api.rpc(
        "confirm_frontend_privacy_export",
        { p_case: input.requestId, p_revision: input.revision, p_export: plan.export_id },
        { get: false }
      );
      if (confirmed.error) {
        if (confirmed.error.code === "42501" && isStaffSecondFactorRefusal(confirmed.error))
          throw new FoundationStaffCommandError(
            403,
            "Verify your authenticator again. Nothing was exported.",
            true
          );
        throw new FoundationStaffCommandError(
          confirmed.error.code === "PT409" ? 409 : confirmed.error.code === "PT413" ? 413 : 503,
          confirmed.error.code === "PT409"
            ? "The member's records changed or this export was already delivered. Nothing was exported. Start the export again."
            : "The data export could not be confirmed. Nothing was exported."
        );
      }
      const parsed = z
        .strictObject({
          ...header,
          export_id: z.literal(plan.export_id),
          generated_at: date,
          datasets: z.record(
            z.string().regex(/^[a-z_]{1,40}$/),
            z.array(z.record(z.string(), z.unknown())).max(2500)
          ),
        })
        .refine(reviewedNames)
        // The rows confirmed are the rows the prepared counts described.
        .refine((v) =>
          Object.entries(v.datasets).every(([name, rows]) => plan.datasets[name] === rows.length)
        )
        .safeParse(confirmed.data);
      if (!parsed.success)
        throw new FoundationStaffCommandError(
          503,
          "The data export could not be confirmed. Nothing was exported."
        );
      const { export_id: _exportId, ...result } = parsed.data;
      return {
        ...result,
        scope:
          "Account records in the listed datasets. Raw identity evidence, credentials, internal storage and provider data, and counterpart contact details are excluded.",
      };
    },
  });
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { uuidSchema } from "@/lib/validations/shared";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { privacyRevision } from "@/lib/foundation/privacy-requests";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "@/lib/foundation/staff-command";

const log = createLogger("DSARExport");

const exportSchema = z.object({ requestId: uuidSchema });

/** Datasets in a foundation access export (33 since database update
 * 20261109073519_post_lifecycle_guards.sql added event_submissions). */
const FOUNDATION_EXPORT_DATASET_COUNT = 33;

/**
 * POST /api/admin/dsar/export  { requestId }
 *
 * Build the complete export of a data subject's records as a download.
 * Needs dsar:manage, a second factor verified in the last 15 minutes, and a
 * verified requester identity. Nothing is stored: the file goes straight to
 * the staff member, who sends it to the requester.
 */
export async function POST(request: Request) {
  return handleFoundationOwnerRoute<{ request_id: string }>({
    request: request instanceof NextRequest ? request : new NextRequest(request),
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
      const rpc = await api.rpc(
        "export_frontend_privacy_request",
        {
          p_case: input.requestId,
          p_revision: input.revision,
        },
        { get: false }
      );
      if (rpc.error?.code === "PT413")
        throw new FoundationStaffCommandError(
          413,
          "The export is too large for a direct download. Nothing was exported."
        );
      const date = z.iso.datetime({ offset: true });
      const result = await settleStaffCommand(
        Promise.resolve(rpc),
        z
          .strictObject({
            request_id: z.literal(input.requestId),
            reference: z.literal(`DSAR-${input.requestId.slice(0, 8).toUpperCase()}`),
            generated_at: date,
            request_type: z.literal("access"),
            received_at: date,
            due_by: date,
            account_found: z.boolean(),
            datasets: z.record(
              z.string().regex(/^[a-z_]{1,40}$/),
              z.array(z.record(z.string(), z.unknown())).max(2500)
            ),
          })
          .refine((v) =>
            v.account_found
              ? Object.keys(v.datasets).length === FOUNDATION_EXPORT_DATASET_COUNT
              : Object.keys(v.datasets).length === 0
          )
      );
      return {
        ...result,
        scope:
          "Account records in the listed datasets. Raw identity evidence, credentials, internal storage and provider data, and counterpart contact details are excluded.",
      };
    },
  });
}

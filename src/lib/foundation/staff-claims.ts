import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { nativeContentReviewSchema } from "../admin/native-content-review";
import { settleStaffCommand } from "./staff-command";
export const frontendClaimTypeSchema = z.enum([
  "report",
  "verification_step",
  "listing",
  "business",
  "promotion",
  "content_edit",
  "business_verification",
]);
export type FrontendClaimType = z.infer<typeof frontendClaimTypeSchema>;
const selection = z.strictObject({
  type: frontendClaimTypeSchema,
  id: z.uuid().transform((v) => v.toLowerCase()),
});
const entry = z
  .strictObject({
    id: z.uuid(),
    subject: z.enum(["post", "report", "case"]),
    queue: z.enum(["content", "reports", "kyc", "business_kyc"]),
    item_type: frontendClaimTypeSchema,
    mine: z.boolean(),
    holder_name: z.string().min(1).max(120),
    generation: nativeContentReviewSchema.shape.claimGeneration.nullable(),
    nonce: z.uuid().nullable(),
    expires_at: z.iso.datetime({ offset: true }),
    revision: z.number().int().positive().nullable(),
    edit_of: z.uuid().nullable(),
  })
  .refine((v) =>
    v.mine ? v.generation !== null && v.nonce !== null : v.generation === null && v.nonce === null
  )
  .refine((v) =>
    v.subject === "post"
      ? v.queue === "content" &&
        ["listing", "business", "promotion", "content_edit"].includes(v.item_type) &&
        v.revision !== null &&
        (v.item_type === "content_edit") === (v.edit_of !== null)
      : v.subject === "report"
        ? v.queue === "reports" &&
          v.item_type === "report" &&
          v.revision === null &&
          v.edit_of === null
        : v.revision !== null &&
          v.edit_of === null &&
          ((v.queue === "kyc" && v.item_type === "verification_step") ||
            (v.queue === "business_kyc" && v.item_type === "business_verification"))
  );
const snapshot = z
  .strictObject({
    account_id: z.uuid(),
    own_count: z.number().int().nonnegative(),
    items: z.array(entry).max(1300),
  })
  .refine((v) => new Set(v.items.map((i) => `${i.subject}:${i.id}`)).size === v.items.length)
  .refine((v) => v.items.filter((i) => i.mine).length === v.own_count);
export async function readFrontendStaffClaims(
  api: FoundationAuthenticatedApi,
  items: Array<{ type: FrontendClaimType; id: string }> = []
) {
  const query = z.array(selection).max(300).parse(items);
  return settleStaffCommand(
    api.rpc("get_frontend_staff_claims", { p_items: query }, { get: false }),
    snapshot
  );
}

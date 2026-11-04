import { z } from "zod";
import { nativeContentReviewSchema } from "./native-content-review";
/** One represented native identity submission. This scope is an opaque fence,
 * never staff authority, an identity fact or a browser liveness attestation. */
export const nativeIdentityScopeSchema = z.strictObject({
  caseId: z.uuid(),
  caseVersion: z.number().int().min(1).max(2147483647),
  submissionId: z.uuid(),
  claimGeneration: nativeContentReviewSchema.shape.claimGeneration,
  claimNonce: z.uuid(),
});
export type NativeIdentityScope = z.infer<typeof nativeIdentityScopeSchema>;

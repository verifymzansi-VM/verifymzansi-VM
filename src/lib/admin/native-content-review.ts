/** A represented native review version and its exact claim lease. These are
 * request fences; every command independently derives staff authority. */
import { z } from "zod";
export const nativeContentReviewSchema = z.strictObject({
  expectedRevision: z.number().int().min(1).max(2147483644),
  claimGeneration: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((v) => BigInt(v) <= BigInt("9223372036854775807")),
  claimNonce: z.uuid(),
});
export type NativeContentReview = z.infer<typeof nativeContentReviewSchema>;

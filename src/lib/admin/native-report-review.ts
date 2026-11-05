import { z } from "zod";
import { nativeContentReviewSchema } from "./native-content-review";
export const nativeReportReviewSchema = nativeContentReviewSchema.extend({
  expectedPostRevision: z.number().int().min(1).max(2147483647).nullable().optional(),
});
export type NativeReportReview = z.infer<typeof nativeReportReviewSchema>;

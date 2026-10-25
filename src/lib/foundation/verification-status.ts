import { z } from "zod";
export const foundationVerificationStatusSchema = z.strictObject({
  case_id: z.uuid().nullable(),
  version: z.number().int().positive().nullable(),
  verified: z.boolean(),
  phone_verified: z.boolean(),
  locality_confirmed: z.boolean(),
  submission_pending: z.boolean(),
  return_reason: z.string().nullable(),
});

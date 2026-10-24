import { z } from "zod";

export const foundationPhoneSendSchema = z.strictObject({
  phone: z.string().regex(/^\+27[6-8][0-9]{8}$/),
});
export const foundationPhoneVerifySchema = z.strictObject({
  challenge_id: z.uuid(),
  code: z.string().regex(/^[0-9]{6}$/),
});
export const foundationPhoneChallengeSchema = z.strictObject({
  challenge_id: z.uuid(),
  expires_at: z.iso.datetime({ offset: true }),
});

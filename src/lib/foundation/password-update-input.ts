import { z } from "zod";
export const foundationRecoveryBindingSchema = z.strictObject({
  valid: z.literal(true),
  recoverySessionId: z.uuid(),
  accountId: z.uuid(),
});

export const foundationPasswordResetSchema = z
  .strictObject({ password: z.string().min(12).max(128), confirmPassword: z.string().max(128) })
  .refine((value) => value.password === value.confirmPassword);

/** The restored reset page sends only the two passwords; the server supplies the
 * recovery session from its own binding (recovery-binding.ts). A client that
 * still sends the id must send the live one. */
export const foundationRecoveryResetSchema = z
  .strictObject({
    password: z.string().min(12).max(128),
    confirmPassword: z.string().max(128),
    recoverySessionId: z.uuid().optional(),
  })
  .refine((value) => value.password === value.confirmPassword);

export const foundationPasswordUpdateSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
    confirmNewPassword: z.string().max(128),
  })
  .refine(
    (value) =>
      value.newPassword === value.confirmNewPassword && value.newPassword !== value.currentPassword
  );

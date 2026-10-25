import { z } from "zod";
export const foundationRecoveryBindingSchema = z.strictObject({
  valid: z.literal(true),
  recoverySessionId: z.uuid(),
  accountId: z.uuid(),
});

export const foundationPasswordResetSchema = z
  .strictObject({ password: z.string().min(12).max(128), confirmPassword: z.string().max(128) })
  .refine((value) => value.password === value.confirmPassword);

export const foundationRecoveryResetSchema = z
  .strictObject({
    password: z.string().min(12).max(128),
    confirmPassword: z.string().max(128),
    recoverySessionId: z.uuid(),
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

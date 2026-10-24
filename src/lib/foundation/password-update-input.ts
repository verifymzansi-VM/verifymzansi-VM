import { z } from "zod";

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

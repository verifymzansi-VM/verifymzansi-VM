import { z } from "zod";
import { foundationAuthEmail, foundationCaptchaToken } from "./auth-input";
import { normalizePersonName, isPersonName, isReservedPersonName } from "./person-name";

export const foundationRegistrationSchema = z
  .strictObject({
    email: foundationAuthEmail,
    displayName: z
      .string()
      .max(400)
      .transform(normalizePersonName)
      .refine(isPersonName)
      .refine((value) => !isReservedPersonName(value)),
    password: z.string().min(12).max(128),
    confirmPassword: z.string().max(128),
    acceptTerms: z.literal(true),
    turnstileToken: foundationCaptchaToken,
  })
  .refine((value) => value.password === value.confirmPassword);

import { z } from "zod";

export const foundationAuthEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const foundationCaptchaToken = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => value.trim() === value && value !== "turnstile-unavailable");

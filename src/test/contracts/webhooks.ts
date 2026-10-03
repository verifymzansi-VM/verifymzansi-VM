import { z } from "zod";

export { KycWebhookPayloadSchema } from "../../lib/validations/kyc-webhook";
const SmsRecipientSchema = z.object({
  statusCode: z.number().int(),
  number: z.string().optional(),
  cost: z.string().optional(),
  status: z.string().optional(),
  messageId: z.string().optional(),
});

export const SmsProviderResponseSchema = z.object({
  SMSMessageData: z.object({
    Message: z.string().optional(),
    Recipients: z.array(SmsRecipientSchema).min(1),
  }),
});

export const EmailProviderResponseSchema = z
  .object({
    data: z
      .object({
        id: z.string().min(1),
      })
      .nullable()
      .optional(),
    error: z
      .object({
        name: z.string().optional(),
        message: z.string().min(1),
      })
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.data && !value.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either data or error must be present",
      });
    }
  });

type _SmsProviderResponse = z.infer<typeof SmsProviderResponseSchema>;
type _EmailProviderResponse = z.infer<typeof EmailProviderResponseSchema>;

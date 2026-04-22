import { z } from "zod";

const KycWebhookStatusSchema = z.enum(["approved", "rejected", "needs_manual_review"]);

export const KycWebhookPayloadSchema = z
  .object({
    provider_ref: z.string().min(1),
    status: KycWebhookStatusSchema,
    reason: z.string().optional(),
    scores: z
      .object({
        face_match_score: z.number().min(0).max(1).nullable().optional(),
        liveness_score: z.number().min(0).max(1).nullable().optional(),
        doc_auth_score: z.number().min(0).max(1).nullable().optional(),
      })
      .optional(),
    ocr_payload: z.record(z.string(), z.unknown()).optional(),
    raw_response: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

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

type _KycWebhookPayload = z.infer<typeof KycWebhookPayloadSchema>;
type _SmsProviderResponse = z.infer<typeof SmsProviderResponseSchema>;
type _EmailProviderResponse = z.infer<typeof EmailProviderResponseSchema>;

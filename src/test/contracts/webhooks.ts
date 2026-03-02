import { z } from "zod";

export const PayFastPaymentStatusSchema = z.enum(["COMPLETE", "FAILED", "PENDING", "CANCELLED"]);

export const PayFastItnPayloadSchema = z
  .object({
    m_payment_id: z.string().min(1),
    payment_status: PayFastPaymentStatusSchema,
    amount_gross: z.string().regex(/^\d+(\.\d{2})$/, "amount_gross must be 0.00 format"),
    signature: z.string().regex(/^[a-f0-9]{32}$/i, "signature must be md5 hex"),
    pf_payment_id: z.string().min(1).optional(),
    item_name: z.string().min(1).optional(),
    item_description: z.string().optional(),
    amount_fee: z
      .string()
      .regex(/^-?\d+(\.\d{2})$/)
      .optional(),
    amount_net: z
      .string()
      .regex(/^-?\d+(\.\d{2})$/)
      .optional(),
  })
  .passthrough();

export const KycWebhookStatusSchema = z.enum(["approved", "rejected", "needs_manual_review"]);

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

export const SmsRecipientSchema = z.object({
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

export type PayFastItnPayload = z.infer<typeof PayFastItnPayloadSchema>;
export type KycWebhookPayload = z.infer<typeof KycWebhookPayloadSchema>;
export type SmsProviderResponse = z.infer<typeof SmsProviderResponseSchema>;
export type EmailProviderResponse = z.infer<typeof EmailProviderResponseSchema>;

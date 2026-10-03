import { z } from "zod";
const score = z
  .number({ error: "Score must be a number" })
  .finite()
  .min(0)
  .max(100)
  .nullable()
  .optional();
const metadata = z.record(z.string().max(200), z.unknown()).superRefine((value, ctx) => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid JSON metadata" });
    return;
  }
  if (new TextEncoder().encode(serialized).byteLength > 50_000)
    ctx.addIssue({ code: "custom", message: "Payload metadata is too large" });
});
/** Shared normalized manual/stub contract. Missing scores and explicit null mean unknown. */
export const KycWebhookPayloadSchema = z.object({
  provider_ref: z
    .string()
    .trim()
    .min(1, "Missing provider_ref in webhook payload")
    .max(128, "provider_ref is too long"),
  status: z.enum(["approved", "rejected", "needs_manual_review"], {
    error: "Invalid webhook status",
  }),
  reason: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z.string().max(1_000, "reason is too long").optional()
  ),
  scores: z
    .object({ face_match_score: score, liveness_score: score, doc_auth_score: score })
    .strict()
    .optional(),
  ocr_payload: metadata.optional(),
  raw_response: metadata.optional(),
});
export type KycWebhookPayload = z.infer<typeof KycWebhookPayloadSchema>;

import { z } from "zod";
import { nativeIdentityScopeSchema } from "../admin/native-identity-review";
import { foundationInstant } from "./public-post-contract";
export const frontendIdentityContextSchema = z
  .strictObject({
    reviewer_id: z.uuid(),
    owner_id: z.uuid(),
    case_id: z.uuid(),
    case_version: z.number().int().positive(),
    submission_id: z.uuid(),
    risk_score: z.number().int().min(0).max(100),
    recipe: z.literal("manual-id-selfie-v1"),
    id_artifact_id: z.uuid(),
    selfie_artifact_id: z.uuid(),
    claim_generation: nativeIdentityScopeSchema.shape.claimGeneration,
    claim_nonce: z.uuid(),
    claim_expires_at: foundationInstant,
    owner_profile: z
      .strictObject({
        display_name: z.string().nullable(),
        account_verification_status: z.enum(["verified", "pending_review"]),
        account_status: z.enum(["active", "restricted", "closed"]),
        strikes: z.null(),
        legal_hold: z.boolean(),
        location_province: z.string().nullable(),
        location_city: z.string().nullable(),
      })
      .nullable(),
    access_log: z
      .array(
        z.strictObject({
          id: z.string(),
          actor_id: z.uuid(),
          actor_role: z.literal("Not recorded"),
          artifact_id: z.uuid(),
          ip_hash: z.null(),
          accessed_at: foundationInstant,
          purpose: z.string().max(100),
        })
      )
      .max(200),
  })
  .refine((v) => v.id_artifact_id !== v.selfie_artifact_id && v.reviewer_id !== v.owner_id);

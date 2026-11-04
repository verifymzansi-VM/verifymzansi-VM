import { z } from "zod";
import { foundationInstant } from "./public-post-contract";
/** Exact native metadata DTO. Stored object keys and document bytes are never
 * part of this read; each private stream has its own current-claim check. */
export const foundationEvidenceMetadataSchema = z
  .strictObject({
    case_id: z.uuid(),
    version: z.number().int().positive(),
    artifacts: z
      .array(
        z.strictObject({
          artifact_id: z.uuid(),
          purpose: z.enum(["id_front", "id_back", "selfie", "proof_of_address", "registration"]),
          size_bytes: z.number().int().positive().max(20000000),
          uploaded_at: foundationInstant,
        })
      )
      .max(1000),
  })
  .refine((v) => new Set(v.artifacts.map((a) => a.artifact_id)).size === v.artifacts.length);

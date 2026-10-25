import "server-only";
import { z } from "zod";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import { deleteFromR2 } from "../services/storage";
import { VARIANT_WIDTHS, variantKeyFor } from "../media/variant-keys";
const shared = {
  object_key: z.string(),
  claim_token: z.uuid(),
  lease_until: z.iso.datetime({ offset: true }),
};
const mediaClaims = z
  .array(
    z.strictObject({
      ...shared,
      object_id: z.uuid(),
      object_key: z.string().regex(/^media\/[a-f0-9-]{36}$/),
    })
  )
  .max(4);
const evidenceClaims = z
  .array(
    z.strictObject({
      ...shared,
      artifact_id: z.uuid(),
      object_key: z.string().regex(/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
    })
  )
  .max(4);
export async function runFoundationRetention(
  service: FoundationServiceApi = createFoundationServiceApi(),
  remove = deleteFromR2
) {
  const swept = await service.rpc("run_retention", { p_limit: 100 });
  if (swept.error) throw new Error("Retention transactions could not be completed");
  const [media, evidence] = await Promise.all([
    service.rpc("claim_media_cleanup", { p_limit: 4 }),
    service.rpc("claim_evidence_cleanup", { p_limit: 4 }),
  ]);
  if (media.error || evidence.error) throw new Error("Storage cleanup could not be claimed");
  const publicRows = mediaClaims.parse(media.data),
    privateRows = evidenceClaims.parse(evidence.data);
  const result = { claimed: publicRows.length + privateRows.length, deleted: 0, retrying: 0 };
  const completed = await Promise.allSettled([
    ...publicRows.map(async (row) => {
      if (Date.parse(row.lease_until) <= Date.now()) {
        result.retrying++;
        return;
      }
      const keys = [
        row.object_key,
        ...VARIANT_WIDTHS.map((width) => variantKeyFor(row.object_key, width)),
      ];
      const deleted = await Promise.allSettled(
        keys.map((key) => remove(process.env.R2_PUBLIC_BUCKET || "verifymzansi-public", key))
      );
      if (deleted.some((item) => item.status === "rejected")) {
        result.retrying++;
        return;
      }
      const marked = await service.rpc("mark_media_deleted", {
        p_object_id: row.object_id,
        p_claim_token: row.claim_token,
      });
      if (marked.error || marked.data !== true) result.retrying++;
      else result.deleted++;
    }),
    ...privateRows.map(async (row) => {
      if (Date.parse(row.lease_until) <= Date.now()) {
        result.retrying++;
        return;
      }
      try {
        await remove(process.env.R2_PRIVATE_BUCKET || "verifymzansi-private", row.object_key);
        const marked = await service.rpc("mark_evidence_deleted", {
          p_artifact: row.artifact_id,
          p_claim_token: row.claim_token,
        });
        if (marked.error || marked.data !== true) result.retrying++;
        else result.deleted++;
      } catch {
        result.retrying++;
      }
    }),
  ]);
  result.retrying += completed.filter((item) => item.status === "rejected").length;
  return result;
}

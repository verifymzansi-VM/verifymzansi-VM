import { z } from "zod";
import type { PublicAffiliation } from "../organisations/affiliations";
import type { FoundationPublicApi } from "./public-api";
import { instant, objectKey, settle, slug } from "./organisations";
import { foundationMediaUrl } from "./public-media-url";

const affiliations = z
  .array(
    z
      .strictObject({
        business_id: z.uuid(),
        organisation_id: z.uuid(),
        organisation_slug: slug,
        organisation_name: z.string(),
        logo_object_key: objectKey.nullable(),
        label: z.string(),
        programme_name: z.string().nullable(),
        confirmed_at: instant,
        sponsored: z.boolean(),
        sponsorship_label: z.string().nullable(),
      })
      .refine((row) => row.sponsored === (row.sponsorship_label !== null))
  )
  .max(1000);

export async function readRestoredBusinessAffiliations(
  api: FoundationPublicApi,
  ids: string[]
): Promise<PublicAffiliation[]> {
  const allowed = new Set(
    z
      .array(z.guid())
      .max(100)
      .parse(ids)
      .map((id) => id.toLowerCase())
  );
  if (allowed.size === 0) return [];
  const rows = await settle(
    api.rpc(
      "get_public_frontend_business_affiliations",
      { p_post_ids: [...allowed] },
      { get: false }
    ),
    affiliations
  );
  if (rows.some((row) => !allowed.has(row.business_id)))
    throw new Error("Public affiliation scope changed");
  return rows.map(({ logo_object_key, ...row }) => ({
    ...row,
    logo_url: foundationMediaUrl(logo_object_key),
  }));
}

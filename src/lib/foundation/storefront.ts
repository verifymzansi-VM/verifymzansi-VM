import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";
import type { StorefrontSummary } from "../presentation/storefront";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const storefront = z
  .strictObject({
    business_id: z.uuid(),
    business_name: z.string().min(1).max(120),
    listings: z.number().int().min(0).max(100000),
    categories: z.record(key, z.number().int().min(1)),
    makes: z.array(z.string().min(1).max(80)).max(1000),
    areas: z.array(z.strictObject({ province: key, city: key })).max(1000),
  })
  .nullable();

/**
 * The storefront a public post belongs to (api.get_public_storefront,
 * 20261121131915_business_storefront.sql): for a business with one, or a
 * listing in one, the business and its filter choices; null otherwise.
 * Throws when the read fails or answers outside the contract.
 */
export async function readFoundationStorefront(
  api: FoundationPublicApi,
  postId: string
): Promise<StorefrontSummary | null> {
  const { data, error } = await api.rpc("get_public_storefront", { p_post_id: postId });
  if (error) throw new Error("Storefront could not be loaded");
  const row = storefront.parse(data);
  return row
    ? {
        businessId: row.business_id,
        businessName: row.business_name,
        listings: row.listings,
        categories: row.categories,
        makes: row.makes,
        areas: row.areas,
      }
    : null;
}

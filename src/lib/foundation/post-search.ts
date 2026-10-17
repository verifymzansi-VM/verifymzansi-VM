import { z } from "zod";
import { publicPostCoreSchema, validPublicPostCore } from "./public-post-contract";
import type { FoundationPublicApi } from "./public-api";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const area = z.enum(["market", "business", "tourism_events"]);
const condition = z.enum(["new", "like_new", "good", "fair", "for_parts"]);
const priceMode = z.enum(["amount", "free", "on_request"]);
const cursor = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/);
const range = z
  .strictObject({ min: z.number().optional(), max: z.number().optional() })
  .refine((value) => value.min === undefined || value.max === undefined || value.min <= value.max);
const request = z
  .strictObject({
    q: z.string().max(200).optional(),
    sort: z.enum(["newest", "relevance"]).optional(),
    area: area.optional(),
    category: key.optional(),
    activity: key.optional(),
    province: key.optional(),
    city: key.optional(),
    condition: condition.optional(),
    price_mode: priceMode.optional(),
    min_price_cents: z.number().int().min(0).max(999999999999).optional(),
    max_price_cents: z.number().int().min(0).max(999999999999).optional(),
    attributes: z.record(key, z.union([z.boolean(), z.string().max(200), range])).optional(),
    cursor: cursor.optional(),
    limit: z.number().int().min(1).max(48).optional(),
  })
  .refine((value) => !value.activity || Boolean(value.category))
  .refine((value) => !value.city || Boolean(value.province))
  .refine(
    (value) =>
      !value.attributes || Object.keys(value.attributes).length === 0 || Boolean(value.category)
  )
  .refine(
    (value) =>
      (value.min_price_cents === undefined && value.max_price_cents === undefined) ||
      value.price_mode === "amount"
  )
  .refine(
    (value) =>
      value.min_price_cents === undefined ||
      value.max_price_cents === undefined ||
      value.min_price_cents <= value.max_price_cents
  );
const item = z
  .strictObject({
    ...publicPostCoreSchema.shape,
    summary: z.string().max(300),
    score: z
      .string()
      .max(40)
      .regex(/^[0-9]+(?:\.[0-9]+)?$/)
      .nullable(),
  })
  .refine(validPublicPostCore);

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const page = z
  .strictObject({
    items: z.array(item).max(48),
    sort: z.enum(["newest", "relevance"]),
    total: count,
    facets: z.strictObject({ categories: z.record(key, count) }),
    next_cursor: cursor.nullable(),
  })
  .refine(
    (value) =>
      new Set(value.items.map((row) => row.id)).size === value.items.length &&
      value.total >= value.items.length
  )
  .refine((value) =>
    value.items.every((row) =>
      value.sort === "relevance" ? row.score !== null : row.score === null
    )
  )
  .refine((value) => value.next_cursor === null || value.items.length > 0);
export type FoundationPostSearchPage = z.infer<typeof page>;

/** Strict public filters only; SQL remains authoritative for current taxonomy,
 * category facets, term normalization, visibility, totals and cursor binding.
 * The opaque cursor is forwarded byte-for-byte, never decoded or rounded.
 */
export function buildFoundationPostSearch(input: unknown) {
  const result = request.safeParse(input);
  if (!result.success) throw new Error("Invalid foundation search request");
  if (new TextEncoder().encode(JSON.stringify(result.data)).length > 4096)
    throw new Error("Invalid foundation search request");
  return { p_request: result.data };
}
export function parseFoundationPostSearch(input: unknown): FoundationPostSearchPage {
  const result = page.safeParse(input);
  if (!result.success) throw new Error("Invalid foundation search response");
  return result.data;
}
export async function searchFoundationPosts(
  api: FoundationPublicApi,
  input: unknown
): Promise<FoundationPostSearchPage> {
  const { data, error } = await api.rpc("search_posts", buildFoundationPostSearch(input));
  if (error) throw new Error("Foundation search unavailable");
  return parseFoundationPostSearch(data);
}

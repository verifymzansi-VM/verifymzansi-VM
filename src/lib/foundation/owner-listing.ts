import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  buildCoreListingTermsCommand,
  restoreCoreListingDraft,
} from "../domains/posts/listing-draft";
import { listingPriceCategorySchema } from "../domains/listings/price-terms";

const id = z.uuid().transform((value) => value.toLowerCase());
const readRequest = z.strictObject({ id });
const saveRequest = z.strictObject({
  id,
  category: listingPriceCategorySchema,
  expected_revision: z.number().int().min(1).max(2147483646),
  form: z.unknown(),
});
export type FoundationListingDraft = ReturnType<typeof restoreCoreListingDraft>;

/** A private owner form DTO, never a public post or staff evidence projection. */
export function parseFoundationListingDraft(input: unknown): FoundationListingDraft | null {
  if (input === null) return null;
  try {
    return restoreCoreListingDraft(input);
  } catch {
    throw new Error("Invalid foundation listing draft");
  }
}
export async function readFoundationListingDraft(
  api: FoundationAuthenticatedApi,
  input: unknown
): Promise<FoundationListingDraft | null> {
  const parsed = readRequest.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation listing draft request");
  const { data, error } = await api.rpc("get_core_listing_draft", { p_id: parsed.data.id });
  if (error) throw new Error("Foundation listing draft unavailable");
  const result = parseFoundationListingDraft(data);
  if (result !== null && result.id !== parsed.data.id)
    throw new Error("Invalid foundation listing draft");
  return result;
}

/** One explicit revision-fenced mutation. The caller token supplies identity;
 * category is form validation context only and SQL derives it from the locked
 * post. Never silently retry: a lost/malformed reply can follow a committed save.
 */
export async function saveFoundationListingTerms(
  api: FoundationAuthenticatedApi,
  input: unknown
): Promise<FoundationListingDraft> {
  const parsed = saveRequest.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation listing terms request");
  let command: ReturnType<typeof buildCoreListingTermsCommand>;
  try {
    command = buildCoreListingTermsCommand(parsed.data);
  } catch {
    throw new Error("Invalid foundation listing terms request");
  }
  const { data, error } = await api.rpc("save_core_listing_terms", command);
  if (error) {
    if (error.code === "PT409")
      throw new Error("Foundation listing draft changed; reload before saving");
    throw new Error("Foundation listing terms unavailable");
  }
  const result = parseFoundationListingDraft(data);
  if (
    result === null ||
    result.id !== parsed.data.id ||
    result.category !== parsed.data.category ||
    result.expected_revision !== parsed.data.expected_revision + 1
  )
    throw new Error("Invalid foundation listing draft");
  return result;
}

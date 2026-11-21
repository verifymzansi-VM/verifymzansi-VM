// Copy a post (business tools plan section 3, SHOW_POST_COPY): the "Post an
// item" form opened on a copy, a draft the server made with
// /api/listings/[id]/copy. The copy is saved with the edit route and then
// submitted for review with the resubmit route, as a rejected post is.
import type { ListingCategory, ListingCondition } from "@/types/enums";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { DEFAULT_LISTING_CONTACT_METHODS, withListingEnquiry } from "@/lib/forms/listing-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The copy's id from `?copy=`, or null. */
export function parseCopyId(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** The form's values from the owner's read of the copy (GET /api/listings/[id]). */
export function listingCopyFields(row: Record<string, unknown>) {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const attributes =
    row.attributes && typeof row.attributes === "object"
      ? (row.attributes as Record<string, string | boolean | string[]>)
      : {};
  return {
    title: text(row.title),
    description: text(row.description),
    price:
      typeof row.price_cents === "number" && row.price_cents > 0
        ? String(row.price_cents / 100)
        : "",
    negotiable: row.price_negotiable === true,
    category: text(row.category) as ListingCategory | "",
    condition: (text(row.condition) || text(attributes.condition)) as ListingCondition | "",
    attributes,
    province: text(row.location_province),
    city: text(row.location_city),
    town: text(row.location_town) || text(row.location_suburb),
    address: text(row.location_address),
    contactMethods:
      Array.isArray(row.contact_methods) && row.contact_methods.length > 0
        ? withListingEnquiry(row.contact_methods as string[])
        : DEFAULT_LISTING_CONTACT_METHODS,
    photos: Array.isArray(row.photos) ? (row.photos as string[]) : [],
    logo: typeof row.logo_url === "string" ? row.logo_url : null,
    focal: {
      x: typeof row.focal_x === "number" ? row.focal_x : 0.5,
      y: typeof row.focal_y === "number" ? row.focal_y : 0.5,
    },
  };
}

/** A copy of a vehicle or property needs one new photo (owner decision). */
export const COPY_NEW_PHOTO_CATEGORIES: readonly string[] = ["vehicles", "property"];
export const COPY_NEW_PHOTO_MESSAGE =
  "Add at least one new photo of this item. Each car or home is a different item.";

/**
 * Saves the copy (PUT /api/listings/[id], which keeps a draft a draft) and
 * submits it for review (POST /api/content/resubmit). Returns the first
 * refusal as a response the form already knows how to show, or the
 * submission's response.
 */
export async function submitListingCopy(
  id: string,
  body: Record<string, unknown>,
  resubmitFields: (revision: number) => Record<string, unknown>
): Promise<Response> {
  const saved = await fetch(`/api/listings/${id}`, {
    method: "PUT",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!saved.ok) return saved;
  const { revision } = (await saved.json().catch(() => ({}))) as { revision?: unknown };
  if (typeof revision !== "number")
    return Response.json({ error: "Reload your posts before trying again." }, { status: 409 });
  const submitted = await fetch("/api/content/resubmit", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId: id, area: "MZANSI_MARKET", ...resubmitFields(revision) }),
  });
  if (submitted.ok) return submitted;
  const { error } = (await submitted.json().catch(() => ({}))) as { error?: unknown };
  return Response.json(
    { error: typeof error === "string" ? error : "The copy could not be submitted." },
    { status: submitted.status === 401 || submitted.status === 422 ? submitted.status : 409 }
  );
}

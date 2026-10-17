import fs from "node:fs";
import { createHash } from "node:crypto";

// Explicit proposals, never automatic carry-forward or approval of legacy columns.
const root = "docs/backend-foundation";
const map = JSON.parse(fs.readFileSync(`${root}/schema-map.json`, "utf8"));
const common = {
  id: "private.posts.id",
  owner_id: "private.posts.owner_id",
  area: "private.posts.area",
  title: "private.posts.title",
  business_name: "private.posts.title",
  description: "private.posts.description",
  category: "private.posts.category_id",
  subcategory: "private.posts.activity_id",
  category_key: "private.posts.category_id",
  status: "private.posts.status",
  created_at: "private.posts.created_at",
  updated_at: "private.posts.content_updated_at",
};
const groups = [
  {
    id: "locality",
    fields: ["location_province", "location_city", "location_suburb", "location_town"],
    target: "private.post_locality",
    action: "Canonical locality IDs and labels; do not infer verified account location",
    visibility: "coarse public locality",
  },
  {
    id: "contacts",
    fields: [
      "phone",
      "whatsapp",
      "email",
      "location_address",
      "store_number",
      "building_name",
      "suite_or_unit",
      "map_directions",
      "contact_methods",
    ],
    target: "private.post_contacts",
    action:
      "Retire public compatibility copies; explicit channels/address purpose and visibility choices",
    visibility: "private; approved reveal/venue projections only",
  },
  {
    id: "media",
    fields: [
      "photos",
      "videos",
      "logo_url",
      "cover_photo",
      "cover_video",
      "video_thumbnail",
      "gallery_photos",
      "media_width",
      "media_height",
      "focal_x",
      "focal_y",
      "blurhash",
      "layout_template",
    ],
    target: "private.post_media / private.media_assets",
    action:
      "Owned validated asset refs with purpose/order; verified metadata; no arbitrary URLs or duplicate cover/gallery quota",
    visibility: "approved public media and display metadata",
  },
  {
    id: "moderation",
    fields: ["status_reason", "approved_edit_count", "edited_since_review"],
    target: "private.post_moderation / private.post_edit_requests",
    action:
      "Derived review state/counter and versioned edit snapshots; no owner-authored approvals",
    visibility: "owner-safe status summary; detailed notes staff only",
  },
  {
    id: "publication",
    fields: [
      "entitlement_id",
      "published_at",
      "expires_at",
      "boost_until",
      "featured_until",
      "urgent_until",
      "featured",
      "urgent",
    ],
    target: "private.post_publication / private.post_activations",
    action: "Canonical funding/source windows and DB-owned placement; retire legacy mirror linkage",
    visibility: "display-safe active status/placement; funding internals private",
  },
  {
    id: "statistics",
    fields: ["view_count", "engaged_view_count", "click_count"],
    target: "private.post_stats",
    action: "Separate content edit time from deduplicated/bounded analytics writes",
    visibility: "approved aggregates only",
  },
  {
    id: "search",
    fields: ["search_vector"],
    target: "private.post_search_documents",
    action:
      "Maintained joined projection; visibility/filter/cursor consistency; not a join in a generated column",
    visibility: "internal index; public approved result DTO only",
  },
];
const listing = [
  "price_cents",
  "price_negotiable",
  "condition",
  "attributes",
  "buyer_verification_required",
];
const business = [
  "business_type",
  "business_details",
  "category_details",
  "services_offered",
  "service_areas",
  "operating_hours",
  "payment_methods_accepted",
  "delivery_options",
  "website",
  "social_links",
];
const event = [
  "promotion_type",
  "event_details",
  "start_date",
  "end_date",
  "business_id",
  "category",
  "category_key",
  "price_cents",
  "price_negotiable",
];
const special = (table, column) => {
  if (column === "slug")
    return {
      id: "aliases",
      target: "private.post_aliases.slug + URL scope",
      action:
        "Define uniqueness by canonical URL scope; preserve approved redirects, not assumed global business uniqueness",
      visibility: "public approved alias",
    };
  if (
    /^(cipc_|seen_)/.test(column) ||
    ["owner_verified_role", "owner_position_title", "show_full_registered_office"].includes(column)
  )
    return {
      id: "trust",
      target: "private.business_badges / private.business_verifications",
      action:
        "Staff-approved expiring badge projection; evidence/registration details separately private",
      visibility: "minimal approved badges only; no client trust claims",
    };
  if (
    column.startsWith("social_distribution_") ||
    ["social_authorization_version", "social_monetization_acknowledged"].includes(column)
  )
    return {
      id: "event-consent",
      target: "private.event_social_authorizations",
      action:
        "Versioned distribution/monetization consent and revocation; no implicit consent from publication",
      visibility: "owner consent summary; operational records private",
    };
  if (table === "public.promotions" && event.includes(column))
    return {
      id: "event-detail",
      target: "private.event_details / private.categories",
      action:
        "Active event taxonomy/window/admission/host; legacy non-event alternatives require explicit disposition; price is admission, not paid posting",
      visibility: "approved visitor facts; private host/funding context separated",
    };
  if (common[column])
    return {
      id: "core",
      target: common[column],
      action:
        column === "updated_at"
          ? "New content-only edit clock; legacy mixed counter/moderation timestamps are not converted"
          : "Canonical explicit identity/content/workflow field; kind/area/category integrity and owner derivation",
      visibility: ["owner_id", "status"].includes(column)
        ? "principal-scoped owner/staff DTO; public safe projection separately reviewed"
        : "approved public identity/content; draft private",
    };
  if (table === "public.listings" && listing.includes(column))
    return {
      id: "listing-detail",
      target: "private.listing_details",
      action:
        "Explicit price modes/negotiation/category applicability/versioned attrs and viewer eligibility; native filters pending",
      visibility:
        "public permitted listing facts; eligibility controls not arbitrary client authority",
    };
  if (table === "public.businesses" && business.includes(column))
    return {
      id: "business-detail",
      target: "private.business_details / private.post_contacts",
      action:
        "Canonical customer access, structured hours/services and versioned category data; split contact/private nested fields; no whole JSON copy",
      visibility: "approved business facts; private fields split before projection",
    };
  return groups.find((group) => group.fields.includes(column));
};
const tables = map.tables.filter((table) =>
  ["public.listings", "public.businesses", "public.promotions"].includes(table.source)
);
const records = tables.flatMap((table) =>
  table.currentColumns.map((column) => {
    const proposal = special(table.source, column.name);
    return {
      source: `${table.source}.${column.name}`,
      sourceType: column.type,
      status: "proposal; full field contract pending",
      group: proposal?.id ?? "unclassified",
      target: proposal?.target ?? null,
      action: proposal?.action ?? "Manual disposition required; never implicitly retain",
      visibility: proposal?.visibility ?? "undecided; deny broad exposure",
      acceptance:
        "Input/display/filter/edit/retention/API tests and independent field review required in BF-03",
    };
  })
);
const result = {
  schemaVersion: 1,
  scope:
    "All source post-table columns grouped into explicit target proposals; not reviewed dispositions",
  sourceMapHash: createHash("sha256")
    .update(fs.readFileSync(`${root}/schema-map.json`))
    .digest("base64url"),
  total: records.length,
  unclassified: records
    .filter((record) => record.group === "unclassified")
    .map((record) => record.source),
  records,
};
fs.writeFileSync(`${root}/post-field-proposals.json`, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(
  JSON.stringify({ total: result.total, unclassified: result.unclassified }) + "\n"
);

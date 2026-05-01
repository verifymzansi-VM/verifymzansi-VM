import { formatZAR } from "@/lib/utils/format";

export interface ContentEditChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

const IGNORED_DIFF_FIELDS = new Set([
  "approved_edit_count",
  "created_at",
  "id",
  "owner_id",
  "published_at",
  "status",
  "updated_at",
]);

const FIELD_LABELS: Record<string, string> = {
  attributes: "Listing details",
  business_details: "Business details",
  business_name: "Business name",
  business_type: "Business type",
  buyer_verification_required: "Buyer verification",
  category: "Category",
  category_key: "Category",
  contact_methods: "Contact methods",
  cover_photo: "Cover photo",
  cover_video: "Cover video",
  delivery_options: "Delivery options",
  description: "Description",
  email: "Email",
  end_date: "End date",
  event_details: "Event details",
  focal_x: "Media focal point",
  focal_y: "Media focal point",
  gallery_photos: "Gallery photos",
  location_address: "Address",
  location_city: "City",
  location_province: "Province",
  location_suburb: "Suburb",
  location_town: "Town",
  logo_url: "Logo",
  map_directions: "Map directions",
  media_height: "Media height",
  media_width: "Media width",
  operating_hours: "Operating hours",
  payment_methods_accepted: "Payment methods",
  phone: "Phone",
  photos: "Photos",
  price_cents: "Price",
  price_negotiable: "Price negotiable",
  promotion_type: "Promotion type",
  service_areas: "Service areas",
  services_offered: "Services offered",
  social_links: "Social links",
  start_date: "Start date",
  store_number: "Store number",
  title: "Title",
  video_thumbnail: "Video thumbnail",
  videos: "Videos",
  website: "Website",
  whatsapp: "WhatsApp",
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForCompare);
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nestedValue]) => [key, normalizeForCompare(nestedValue)])
    );
  }

  return value ?? null;
}

function valuesEqual(before: unknown, after: unknown) {
  return JSON.stringify(normalizeForCompare(before)) === JSON.stringify(normalizeForCompare(after));
}

function labelForField(field: string) {
  return (
    FIELD_LABELS[field] ??
    field
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function summarizeArray(value: unknown[]) {
  if (value.length === 0) return "None";
  if (value.every((item) => typeof item === "string")) {
    return value.join(", ");
  }
  return `${value.length} item${value.length === 1 ? "" : "s"}`;
}

function formatMoneyFromCents(value: number) {
  return formatZAR(value);
}

function formatMediaArray(field: string, value: unknown[]) {
  if (!["photos", "videos", "gallery_photos"].includes(field)) {
    return summarizeArray(value);
  }

  const label = field === "videos" ? "video" : "photo";
  return `${value.length} ${label}${value.length === 1 ? "" : "s"}`;
}

function formatContentEditValue(value: unknown, field = ""): string {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "price_cents" && typeof value === "number") return formatMoneyFromCents(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return formatMediaArray(field, value);

  if (isPlainRecord(value)) {
    const entries = Object.entries(value).filter(
      ([, nestedValue]) => nestedValue !== null && nestedValue !== undefined && nestedValue !== ""
    );
    if (entries.length === 0) return "None";
    return entries
      .slice(0, 4)
      .map(([key, nestedValue]) => `${labelForField(key)}: ${formatContentEditValue(nestedValue)}`)
      .join("; ");
  }

  return String(value);
}

export function getContentEditChanges(
  currentSnapshot: Record<string, unknown> | null | undefined,
  proposedData: Record<string, unknown> | null | undefined
): ContentEditChange[] {
  const current = currentSnapshot ?? {};
  const proposed = proposedData ?? {};

  return Object.keys(proposed)
    .filter((field) => !IGNORED_DIFF_FIELDS.has(field))
    .filter((field) => !valuesEqual(current[field], proposed[field]))
    .sort((a, b) => labelForField(a).localeCompare(labelForField(b)))
    .map((field) => ({
      field,
      label: labelForField(field),
      before: formatContentEditValue(current[field], field),
      after: formatContentEditValue(proposed[field], field),
    }));
}

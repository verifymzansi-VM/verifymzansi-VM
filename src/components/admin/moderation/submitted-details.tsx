import { PostLinks } from "@/components/listings/post-links";
import { CATEGORIES, EVENT_AGE_RESTRICTIONS, EVENT_TYPES } from "@/lib/constants/categories";
import { getCategoryDetailFields } from "@/lib/forms/business-category-details";
import { VISITOR_FEATURE_LABELS } from "@/lib/forms/business-form";
import {
  EVENT_ID_CHECK_LINE,
  eventChecksId,
  eventEntryFacts,
} from "@/lib/forms/event-entry-details";
import type { EventDetails } from "@/types/tourism-details";
import {
  TOURISM_SPOTLIGHT_KEYS,
  tourismCancellationText,
  getTourismSpotlightFacts,
} from "@/lib/presentation/business-facts";
import { buildListingFacts } from "@/lib/presentation/listing-facts";
import { BUSINESS_CATEGORY_LABELS, type BusinessCategory } from "@/types/enums";
import { formatZAR } from "@/lib/utils/format";

export type DetailRow = { label: string; value: string };

type Item = {
  contentType?: "listing" | "business" | "promotion";
  category?: string;
  subcategory?: string | null;
  attributes?: Record<string, unknown>;
  contact_methods?: string[];
  website?: string | null;
  social_links?: Record<string, string> | null;
  category_details?: Record<string, unknown> | null;
  business_details?: object | null;
  operating_hours?: Record<string, unknown> | null;
  event_details?: Record<string, unknown> | null;
  start_date?: string | null;
  end_date?: string | null;
  price_cents?: number | null;
};

const CONTACT_LABELS: Record<string, string> = {
  call: "Call (verified number)",
  whatsapp: "WhatsApp (verified number)",
  in_app: "Private enquiry",
  form: "VerifyMzansi inbox",
  website: "Website",
};

/** "food_dining" -> "Food & Dining", "clothing_accessories" -> "Clothing & Accessories". */
export function plainCategoryName(item: Item): string | null {
  if (!item.category) return null;
  if (item.contentType === "listing")
    return CATEGORIES.find((entry) => entry.value === item.category)?.label ?? null;
  if (item.contentType === "promotion") {
    const type = item.event_details?.event_type ?? item.subcategory;
    return EVENT_TYPES.find((entry) => entry.value === type)?.label ?? "Event";
  }
  return BUSINESS_CATEGORY_LABELS[item.category as BusinessCategory] ?? null;
}

function plain(value: unknown, options?: ReadonlyArray<string | { value: string; label: string }>) {
  const label = (one: unknown) => {
    const found = options?.find((option) =>
      typeof option === "string" ? option === one : option.value === one
    );
    return found ? (typeof found === "string" ? found : found.label) : String(one);
  };
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (value && typeof value === "object") return null;
  return label(value);
}

function filled(value: unknown) {
  return !(
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function dateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        dateStyle: "medium",
        timeStyle: "short",
      });
}

const EVENT_KEYS: Array<[string, string]> = [
  ["venue_name", "Venue"],
  ["venue_capacity", "Capacity"],
  ["lineup", "Line-up"],
  ["tickets_url", "Tickets link"],
  ["parking_available", "Parking"],
  ["food_drinks_available", "Food and drinks"],
  ["bring_your_own", "Bring your own"],
  ["accessibility", "Accessibility"],
  ["rain_policy", "If it rains"],
];

/** Every answer the poster entered, with plain labels, for the staff review screen. */
function submittedDetailRows(item: Item): DetailRow[] {
  const rows: DetailRow[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) rows.push({ label, value });
  };
  if (item.contentType === "listing") {
    rows.push(
      ...buildListingFacts({ category: item.category ?? null, attributes: item.attributes ?? null })
    );
  }
  if (item.contentType === "promotion") {
    const details = item.event_details ?? {};
    push("Starts", dateTime(item.start_date));
    push("Ends", dateTime(item.end_date));
    push("Entry", item.price_cents ? `Paid from ${formatZAR(item.price_cents)}` : "Free");
    const tiers = Array.isArray(details.ticket_tiers) ? details.ticket_tiers : [];
    push(
      "Ticket types",
      tiers
        .map((tier) =>
          tier && typeof tier === "object"
            ? `${String((tier as { name?: unknown }).name ?? "")} ${
                typeof (tier as { price_cents?: unknown }).price_cents === "number"
                  ? formatZAR((tier as { price_cents: number }).price_cents)
                  : ""
              }`.trim()
            : ""
        )
        .filter(Boolean)
        .join(", ")
    );
    rows.push(...eventEntryFacts(details as EventDetails));
    const age = EVENT_AGE_RESTRICTIONS.find((entry) => entry.value === details.age_restriction);
    if (age)
      push("Age", eventChecksId(age.value) ? `${age.label} (${EVENT_ID_CHECK_LINE})` : age.label);
    for (const [key, label] of EVENT_KEYS)
      if (filled(details[key])) push(label, plain(details[key]));
  }
  if (item.contentType === "business") {
    const details = item.category_details ?? {};
    const spotlight = getTourismSpotlightFacts(details);
    rows.push(...spotlight.map(({ label, value }) => ({ label, value: String(value) })));
    // Keys the spotlight lines above already said; an older cancellation choice
    // (flexible, strict…) has no spotlight wording, so it keeps its own row.
    // The price unit is part of the "From" price line.
    const skip = new Set<string>(
      spotlight.length
        ? [
            ...TOURISM_SPOTLIGHT_KEYS.filter(
              (key) => key !== "cancellation_policy" || tourismCancellationText(details)
            ),
            "price_unit",
          ]
        : []
    );
    for (const field of getCategoryDetailFields(item.category as BusinessCategory)) {
      if (skip.has(field.name) || !filled(details[field.name])) continue;
      push(field.label, plain(details[field.name], field.options));
    }
    if (typeof details.booking_url === "string" && !skip.has("booking_url"))
      push("Booking link", details.booking_url);
    const business = (item.business_details ?? {}) as Record<string, unknown>;
    if (business.walk_in_policy === "walk_ins_welcome") push("Walk-ins", "Walk-ins welcome");
    if (Array.isArray(business.visitor_features))
      push(
        "For visitors",
        business.visitor_features
          .map(
            (value) =>
              VISITOR_FEATURE_LABELS[value as keyof typeof VISITOR_FEATURE_LABELS] ?? String(value)
          )
          .join(", ")
      );
    const hours = item.operating_hours ?? {};
    if (hours.Open_24_hours === true) push("Hours", "Open 24 hours");
    if (hours.By_appointment === true) push("Hours", "By appointment");
  }
  if (item.contact_methods?.length)
    push(
      "Contact",
      item.contact_methods.map((method) => CONTACT_LABELS[method] ?? method).join(", ")
    );
  return rows;
}

/** The website and social links, from the post or (events) its event details. */
function submittedLinks(item: Item) {
  const event = item.event_details ?? {};
  return {
    website: item.website || (typeof event.website === "string" ? event.website : null),
    social:
      item.social_links ??
      (event.social_links && typeof event.social_links === "object"
        ? (event.social_links as Record<string, string>)
        : null),
  };
}

/** Everything entered, then the links as real links. */
export function SubmittedDetails({ item }: { item: Item }) {
  const rows = submittedDetailRows(item);
  const links = submittedLinks(item);
  return (
    <div className="space-y-3" data-submitted-details>
      {rows.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">Everything entered</h4>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {rows.map((row, index) => (
              <div key={`${row.label}-${index}`} className="text-sm">
                <dt className="inline text-muted-foreground">{row.label}:</dt>{" "}
                <dd className="inline font-medium break-words">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <PostLinks website={links.website} social={links.social} />
    </div>
  );
}

import { describeListingPrice } from "@/lib/presentation/listing-facts";

/**
 * A business's storefront (business tools plan section 1, item 17b): what the
 * public read api.get_public_storefront says about it, as the pages use it.
 */
export interface StorefrontSummary {
  businessId: string;
  businessName: string;
  /** Live listings in the storefront. */
  listings: number;
  /** Listings per category key. */
  categories: Record<string, number>;
  /** Vehicle makes among the listings (the Make filter's choices). */
  makes: string[];
  /** Province and city of the property listings (the Area filter's choices). */
  areas: Array<{ province: string; city: string }>;
}

/** Which filters and card facts a storefront uses: set by what most posts are. */
export type StorefrontTrade = "vehicles" | "property" | "other";

export function storefrontTrade(categories: Record<string, number>): StorefrontTrade {
  let best: [string, number] | null = null;
  for (const entry of Object.entries(categories).sort(([a], [b]) => a.localeCompare(b)))
    if (!best || entry[1] > best[1]) best = entry;
  return best?.[0] === "vehicles" || best?.[0] === "property" ? best[0] : "other";
}

const NOUNS: Record<StorefrontTrade, [string, string]> = {
  vehicles: ["car", "cars"],
  property: ["property", "properties"],
  other: ["item", "items"],
};

/** "18 cars", "1 property", "6 items". */
export function stockCount(trade: StorefrontTrade, count: number) {
  const [one, many] = NOUNS[trade];
  return `${count} ${count === 1 ? one : many}`;
}

/** The fields a storefront card shows; plain values, safe to send to the browser. */
export interface StorefrontCardData {
  id: string;
  title: string;
  price: string;
  image: string | null;
  hasVideo: boolean;
  /** "2019 · 98 000 km · Manual", "3 beds · 2 baths · 1 parking", or empty. */
  facts: string;
}

const number = new Intl.NumberFormat("en-ZA");
const GEARBOX: Record<string, string> = { manual: "Manual", automatic: "Auto" };

function count(value: unknown, one: string, many: string) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && value !== null && value !== ""
    ? `${n} ${n === 1 ? one : many}`
    : null;
}

/** The card facts of one listing for a trade; the town is never repeated. */
export function storefrontFacts(trade: StorefrontTrade, attributes: Record<string, unknown>) {
  const parts =
    trade === "vehicles"
      ? [
          attributes.year ? String(attributes.year) : null,
          attributes.mileage_km != null && Number.isFinite(Number(attributes.mileage_km))
            ? `${number.format(Number(attributes.mileage_km))} km`
            : null,
          GEARBOX[String(attributes.transmission)] ?? null,
        ]
      : trade === "property"
        ? [
            count(attributes.bedrooms, "bed", "beds"),
            count(attributes.bathrooms, "bath", "baths"),
            count(attributes.parking_spots, "parking", "parking"),
          ]
        : [];
  return parts.filter(Boolean).join(" · ");
}

/** A public listing row (readRestoredCollection) as a storefront card. */
export function storefrontCard(
  trade: StorefrontTrade,
  row: {
    id: string;
    title: string;
    category: string | null;
    price_cents: number | null;
    price_mode?: string | null;
    video_thumbnail?: string | null;
    photos?: string[] | null;
    videos?: string[] | null;
    attributes?: unknown;
  }
): StorefrontCardData {
  const price = describeListingPrice(row);
  const attributes =
    row.attributes && typeof row.attributes === "object"
      ? (row.attributes as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    title: row.title,
    price: price.label,
    image: row.video_thumbnail || row.photos?.[0] || null,
    hasVideo: Boolean(row.videos?.length),
    facts: storefrontFacts(trade, attributes),
  };
}

/** Cards per page of a storefront ("Show more" adds the next page). */
export const STOREFRONT_PAGE_SIZE = 24;

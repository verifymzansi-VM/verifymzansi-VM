import { Building2, ShoppingBag, TreePalm, type LucideIcon } from "lucide-react";
import {
  BUSINESS_CATEGORY_LABELS,
  CATEGORY_LABELS,
  type BusinessCategory,
  type ListingCategory,
} from "@/types/enums";
import { formatSaShortDate, formatZARShort } from "@/lib/utils/format";
import type { SearchResultCardData } from "./search-result-card";

export interface SearchArea {
  key: "listings" | "businesses" | "promotions";
  label: string;
  /** Area landing page, also used for "See all" with the query applied. */
  browseHref: string;
  browseLabel: string;
  icon: LucideIcon;
  tone: "market" | "business" | "tourism";
  tileClassName: string;
}

export const SOURCES = [
  {
    key: "listings",
    label: "Mzansi Market",
    browseHref: "/mzansi-market",
    browseLabel: "Browse Mzansi Market",
    icon: ShoppingBag,
    tone: "market",
    tileClassName: "area-market-tile",
  },
  {
    key: "businesses",
    label: "Businesses",
    browseHref: "/mzansi-business",
    browseLabel: "Browse Mzansi Business",
    icon: Building2,
    tone: "business",
    tileClassName: "area-business-tile",
  },
  {
    key: "promotions",
    label: "Tourism & Events",
    browseHref: "/tourism-events",
    browseLabel: "Browse Tourism & Events",
    icon: TreePalm,
    tone: "tourism",
    tileClassName: "area-tourism-tile",
  },
] as const satisfies readonly SearchArea[];

export type Source = (typeof SOURCES)[number];

/** Minimum shape every result row must have; everything else is optional. */
export type Result = {
  id: string;
  title?: string;
  business_name?: string;
  description?: string;
  category?: string;
  [key: string]: unknown;
};

export function isValidResult(row: unknown): row is Result {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    (typeof r.title === "string" || typeof r.business_name === "string") &&
    (r.title == null || typeof r.title === "string") &&
    (r.business_name == null || typeof r.business_name === "string") &&
    (r.description == null || typeof r.description === "string")
  );
}

function resultHref(source: Source, row: Result) {
  const base =
    source.key === "listings"
      ? "/listing"
      : source.key === "promotions" || row.category === "tourism_hospitality"
        ? "/tourism-events"
        : "/mzansi-business";
  return `${base}/${encodeURIComponent(row.id)}`;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstText(value: unknown): string | undefined {
  return Array.isArray(value) ? value.map(text).find(Boolean) : undefined;
}

function positiveCents(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** "beauty_wellness" → "Beauty wellness" for keys without a display label. */
function humanizeKey(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function location(row: Result): string | undefined {
  const parts = [text(row.location_city), text(row.location_province)].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function listingCategoryLabel(category: unknown): string | undefined {
  const key = text(category);
  if (!key) return undefined;
  const label = CATEGORY_LABELS[key as ListingCategory] ?? humanizeKey(key);
  // "Vehicles (Cars, Bakkies & Commercial)" → "Vehicles" keeps the card tidy.
  return label.replace(/\s*\(.*\)\s*$/, "");
}

function businessCategoryLabel(category: unknown): string | undefined {
  const key = text(category);
  if (!key) return undefined;
  return BUSINESS_CATEGORY_LABELS[key as BusinessCategory] ?? humanizeKey(key);
}

const PROMOTION_TYPE_SINGULAR: Record<string, string> = {
  event: "Event",
  deal: "Deal",
  product: "Promotion",
  service: "Promotion",
};

/** Maps an API row to the display fields a result card needs. */
export function toCardData(source: Source, row: Result): SearchResultCardData {
  const base = {
    id: row.id,
    href: resultHref(source, row),
    title: (row.business_name || row.title || "").trim() || "Untitled",
    description: text(row.description),
    location: location(row),
  };

  if (source.key === "listings") {
    const cents = positiveCents(row.price_cents);
    return {
      ...base,
      imageUrl: firstText(row.photos) ?? text(row.video_thumbnail),
      eyebrow: listingCategoryLabel(row.category),
      price: cents ? formatZARShort(cents) : undefined,
      negotiable: Boolean(cents && row.price_negotiable === true),
    };
  }

  if (source.key === "businesses") {
    return {
      ...base,
      imageUrl:
        text(row.cover_photo) ??
        firstText(row.gallery_photos) ??
        text(row.video_thumbnail) ??
        text(row.logo_url),
      eyebrow: businessCategoryLabel(row.category),
    };
  }

  const cents = positiveCents(row.price_cents);
  const type = text(row.promotion_type);
  const start = text(row.start_date);
  return {
    ...base,
    imageUrl: firstText(row.photos) ?? text(row.video_thumbnail),
    eyebrow:
      (type && PROMOTION_TYPE_SINGULAR[type]) ??
      businessCategoryLabel(row.category_key) ??
      (text(row.category) ? humanizeKey(text(row.category)!) : undefined),
    price: cents ? formatZARShort(cents) : undefined,
    date: type === "event" && start ? formatSaShortDate(start) || undefined : undefined,
  };
}

const PAGES = [
  {
    href: "/mzansi-market",
    title: "Mzansi Market",
    description: "Buy and sell products, vehicles, property and classifieds.",
  },
  {
    href: "/mzansi-business",
    title: "Mzansi Business",
    description: "Find local businesses and professional services.",
  },
  {
    href: "/tourism-events",
    title: "Tourism & Events",
    description: "Accommodation, restaurants, experiences, venues and events.",
  },
  {
    href: "/verification",
    title: "Verification",
    description: "Verify your identity, phone and account.",
  },
  { href: "/verify-buyer", title: "Verify a buyer", description: "Check buyer verification." },
  {
    href: "/help/verification",
    title: "Verification help",
    description: "Help with identity verification and documents.",
  },
  { href: "/pricing", title: "Pricing", description: "Plans, subscriptions, fees and payments." },
  { href: "/advertise", title: "Advertise", description: "Promote your business and posts." },
  {
    href: "/post/create",
    title: "Create a post",
    description: "Post a listing, business, tourism or event.",
  },
  {
    href: "/dashboard",
    title: "Dashboard",
    description: "Manage your account, posts, leads and settings.",
  },
  { href: "/contact", title: "Contact", description: "Contact support for help." },
  {
    href: "/trust-safety",
    title: "Trust & Safety",
    description: "Trust, accountability, refunds and safety policies.",
  },
  { href: "/safety", title: "Safety Centre", description: "Report problems, scams and appeals." },
  {
    href: "/safety/scam-alerts",
    title: "Scam Alerts",
    description: "Avoid fraud and common scams.",
  },
  {
    href: "/safety/meeting-checklist",
    title: "Meeting Safety Checklist",
    description: "Stay safe when meeting buyers and sellers.",
  },
  { href: "/terms", title: "Terms of Service", description: "Website rules and terms." },
  { href: "/privacy", title: "Privacy Policy", description: "Personal data protection and POPIA." },
  { href: "/paia", title: "PAIA Manual", description: "Access to information and records." },
  {
    href: "/dsar",
    title: "Data rights request",
    description: "Access, correct or delete your personal data.",
  },
] as const;

export function matchPages(query: string) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return PAGES.filter((page) =>
    words.every((word) => `${page.title} ${page.description}`.toLocaleLowerCase().includes(word))
  );
}

export const POPULAR_SEARCHES = [
  "Phones",
  "Bakkies",
  "Furniture",
  "Plumber",
  "Catering",
  "Hair salon",
  "Guest house",
  "Live music",
] as const;

export const AREA_SHORTCUTS: Record<
  Source["key"],
  { links: ReadonlyArray<{ label: string; href: string }> }
> = {
  listings: {
    links: [
      { label: "Vehicles", href: "/mzansi-market?category=vehicles" },
      { label: "Phones & electronics", href: "/mzansi-market?category=electronics" },
      { label: "Property", href: "/mzansi-market?category=property" },
      { label: "Home & lifestyle", href: "/mzansi-market?category=home_lifestyle" },
    ],
  },
  businesses: {
    links: [
      { label: "Trades & repairs", href: "/mzansi-business?category=trade_maintenance" },
      { label: "Food & dining", href: "/mzansi-business?category=food_dining" },
      { label: "Health & beauty", href: "/mzansi-business?category=health_beauty" },
      { label: "Professional services", href: "/mzansi-business?category=professional_services" },
    ],
  },
  promotions: {
    links: [
      { label: "Events", href: "/tourism-events?tab=events" },
      { label: "Guest houses & B&Bs", href: "/tourism-events?subcategory=guest_house_bnb" },
      { label: "Tours", href: "/tourism-events?subcategory=tour_operator" },
      { label: "Adventure", href: "/tourism-events?subcategory=adventure_activities" },
    ],
  },
};

export const HELP_SHORTCUTS = [
  { label: "How verification works", href: "/help/verification" },
  { label: "Scam alerts", href: "/safety/scam-alerts" },
  { label: "Meeting safety checklist", href: "/safety/meeting-checklist" },
  { label: "Contact support", href: "/contact" },
] as const;

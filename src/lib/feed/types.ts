import type { ContentTargetType } from "@/lib/engagement";
import type { TrustLevel } from "@/types/enums";

/** Content tables the viewer can show. `tourism` is a /tourism-events link not yet resolved. */
export type FeedTable = "listings" | "businesses" | "promotions";
export type FeedRefKind = "l" | "b" | "p" | "t";

/** A pointer to one post in a sequence. Never carries post data. */
export interface FeedRef {
  kind: FeedRefKind;
  id: string;
}

import type { BusinessStickerState } from "@/lib/business-verification/public";

export type FeedSlideKind = "listing" | "business" | "tourism" | "event";
export type FeedVertical = "market" | "business" | "tourism";

export interface FeedMediaItem {
  kind: "video" | "photo";
  url: string;
  poster?: string;
}

export interface FeedFact {
  label: string;
  value: string;
  wide?: boolean;
}

export interface FeedLink {
  label: string;
  href: string;
  icon: "web" | "map" | "social" | "email" | "tickets" | "calendar" | "booking";
  /** Social network key ("facebook", "instagram"…) so it can be shown as its own icon. */
  platform?: string;
}

/** Panel content blocks. The renderer styles every block the same way on the dark stage. */
export type FeedSection =
  | { type: "facts"; id: string; title: string; eyebrow?: string; facts: FeedFact[] }
  | { type: "text"; id: string; title: string; body: string; clamp?: boolean }
  | { type: "chips"; id: string; title: string; items: string[] }
  | { type: "rows"; id: string; title: string; rows: FeedFact[] }
  | { type: "hours"; id: string; title: string; hours: FeedOpeningHours }
  | { type: "links"; id: string; title: string; links: FeedLink[] }
  | {
      type: "tickets";
      id: string;
      title: string;
      tiers: { name: string; price: string }[];
      buyUrl: string | null;
    }
  | { type: "photos"; id: string; title: string; photos: { url: string; alt: string }[] }
  | {
      type: "posts";
      id: string;
      title: string;
      posts: {
        key: string;
        title: string;
        href: string;
        image: string | null;
        meta: string | null;
      }[];
    }
  | { type: "safety"; id: string }
  | { type: "contact"; id: string };

/** Mon_Fri / Sat / Sun free-text hours as stored on businesses.operating_hours. */
export interface FeedOpeningHours {
  Mon_Fri?: string;
  Sat?: string;
  Sun?: string;
}

export interface FeedContact {
  phone: string | null;
  whatsapp: string | null;
  showPhoneButton: boolean;
  showMessageButton: boolean;
  /** The main action when it is not a phone call: a stay's booking page. */
  cta: { label: string; href: string; icon: "booking" | "tickets" } | null;
}

export interface FeedSlide {
  /** `${table}:${id}` — unique across tables. */
  key: string;
  kind: FeedSlideKind;
  table: FeedTable;
  targetType: ContentTargetType;
  vertical: FeedVertical;
  id: string;
  /** Canonical public path, never carries a feed context. */
  href: string;
  title: string;
  /** Used for the share sheet and the WhatsApp greeting. */
  shareTitle: string;
  media: FeedMediaItem[];
  headline: {
    chips: string[];
    /** Gold primary figure (price, "from R150", star grade). */
    figure: { value: string; note?: string } | null;
    figureNote?: string | null;
    meta: { icon: "date" | "location" | "views" | "type"; text: string }[];
    /** ISO dates for live state/countdown on events; resolved in the browser. */
    event?: { start: string | null; end: string | null; calendarUrl: string | null };
    /** Opening hours for the live "Open now" chip on businesses. */
    hours?: FeedOpeningHours | null;
  };
  owner: {
    label: string;
    name: string;
    initials: string;
    trustLevel: TrustLevel | null;
    logoUrl: string | null;
    /** Profile to open from the owner card (an event's organiser business). */
    href: string | null;
    /** Verified position on a business: from CIPC, or confirmed by the company. */
    position?: string | null;
    positionSource?: string | null;
    /** Business verification stickers (businesses only). */
    stickers?: BusinessStickerState | null;
  };
  contact: FeedContact;
  engagement: { views: number; likes: number; viewerHasLiked: boolean; shares?: number | null };
  website: string | null;
  /** The owner's own map link (Google Maps share link); never guessed from the address. */
  mapUrl: string | null;
  left: FeedSection[];
  right: FeedSection[];
}

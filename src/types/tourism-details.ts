/* ══════════════════════════════════════════════════════════════
   Tourism & Events — TypeScript interfaces
   Stored in `category_details` JSONB (businesses) and
   `event_details` JSONB (promotions)
   ══════════════════════════════════════════════════════════════ */

/** Listing‐type picker on the create-tourism form */
export type TourismListingType = "tourism_business" | "event";

/* ── Tourism Business (stored in businesses.category_details) ── */

export interface TourismCategoryDetails {
  /** Sub‐category key from TOURISM_SUBCATEGORIES */
  subcategory?: string;
  /** 1–5 star rating */
  star_rating?: number;
  /** Total rooms / units available */
  number_of_rooms?: number;
  /** e.g. ["Single room", "Suite"] */
  accommodation_types?: string[];
  /** HH:mm format */
  check_in_time?: string;
  /** HH:mm format */
  check_out_time?: string;
  /** Key from TOURISM_PRICE_RANGES */
  price_range?: string;
  /** Subset of TOURISM_AMENITIES */
  amenities?: string[];
  /** Subset of TOURISM_MEAL_OPTIONS */
  meal_options?: string[];
  /** Free‐text comma list, e.g. "English, Zulu, Afrikaans" */
  languages_spoken?: string;
  /** Key from TOURISM_CANCELLATION_POLICIES */
  cancellation_policy?: string;
  /** External booking URL */
  booking_url?: string;
  pets_allowed?: boolean;
  smoking_allowed?: boolean;
}

/* ── Event (stored in promotions.event_details) ── */

export interface TicketTier {
  name: string;
  /** Price in ZAR cents, null = free tier */
  price_cents: number | null;
}

export interface EventDetails {
  /** Key from EVENT_TYPES */
  event_type?: string;
  venue_name?: string;
  /** Max attendee capacity */
  venue_capacity?: number;
  /** Structured ticket pricing */
  ticket_tiers?: TicketTier[];
  /** External ticketing URL */
  tickets_url?: string;
  /** Key from EVENT_AGE_RESTRICTIONS */
  age_restriction?: string;
  dress_code?: string;
  /** Performers / speakers / lineup */
  lineup?: string;
  parking_available?: boolean;
  /** Subset of EVENT_ACCESSIBILITY_OPTIONS */
  accessibility?: string[];
  food_drinks_available?: boolean;
  /** Guidance text: what attendees can bring */
  bring_your_own?: string;
}

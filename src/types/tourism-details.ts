/* ══════════════════════════════════════════════════════════════
   Tourism & Events — TypeScript interfaces
   Stored in `category_details` JSONB (businesses) and
   `event_details` JSONB (promotions)
   ══════════════════════════════════════════════════════════════ */

/** Listing‐type picker on the create-tourism form */
export type TourismListingType = "tourism_business" | "event";

export interface TourismCategorySpecificFormFields {
  treatmentTypes: string[];
  activityTypes: string[];
  tourDuration: string;
  maxGroupSize: string;
  difficultyLevel: string;
  equipmentProvided: boolean;
  whatsIncluded: string;
  tourismAgeRestriction: string;
  servicesOffered: string[];
  tourismSpecializations: string[];
  guidedTours: boolean;
  audioGuide: boolean;
  visitDuration: string;
  vehicleTypes: string[];
  deliveryCollection: boolean;
  minDriverAge: string;
  insuranceIncluded: boolean;
  gpsAvailable: boolean;
}

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

  /* ── Spa & Wellness (Group B) ── */
  /** Subset of TOURISM_TREATMENT_TYPES */
  treatment_types?: string[];

  /* ── Tours & Safaris (Group C) ── */
  /** Subset of TOURISM_ACTIVITY_TYPES[subcategory] */
  activity_types?: string[];
  /** Key from TOURISM_TOUR_DURATIONS */
  tour_duration?: string;
  max_group_size?: number;
  /** Key from TOURISM_DIFFICULTY_LEVELS (adventure_activities only) */
  difficulty_level?: string;
  equipment_provided?: boolean;
  /** Free-text description of what's included */
  whats_included?: string;
  /** Key from TOURISM_AGE_RESTRICTIONS */
  age_restriction?: string;

  /* ── Travel Agency (Group D) ── */
  /** Subset of TOURISM_TRAVEL_SERVICES */
  services_offered?: string[];
  /** Subset of TOURISM_TRAVEL_SPECIALIZATIONS */
  specializations?: string[];

  /* ── Attractions & Sites (Group E) ── */
  guided_tours?: boolean;
  audio_guide?: boolean;
  /** Key from TOURISM_VISIT_DURATIONS */
  visit_duration?: string;

  /* ── Car Rental (Group F) ── */
  /** Subset of TOURISM_VEHICLE_TYPES */
  vehicle_types?: string[];
  delivery_collection?: boolean;
  min_driver_age?: number;
  insurance_included?: boolean;
  gps_available?: boolean;
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

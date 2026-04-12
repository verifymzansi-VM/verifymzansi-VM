import type { TourismListingType } from "@/types/tourism-details";
import type { SocialAuthorizerRelationship } from "@/types/enums";
import { TOURISM_SUBCATEGORY_FIELD_GROUPS } from "@/lib/constants/categories";

/* ── Regex ───────────────────────────────────────────────── */

const SA_PHONE_REGEX = /^(\+27|0)[6-8][0-9]{8}$/;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function hasValidMoneyPrecision(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 0.001;
}

/* ── Form value interfaces ───────────────────────────────── */

export interface TourismFormValues {
  /* shared */
  listingType: TourismListingType;
  title: string;
  description: string;
  province: string;
  city: string;
  locationAddress?: string;
  locationTown?: string;
  contactMethods: string[];

  /* tourism business */
  subcategory: string;
  starRating: string;
  numberOfRooms: string;
  bookingUrl: string;
  languagesSpoken: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTwitter: string;
  socialTiktok: string;

  /* category-specific tourism fields */
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

  /* event */
  eventType: string;
  startDate: string;
  endDate: string;
  priceZar: string;
  venueName: string;
  venueCapacity: string;
  ticketsUrl: string;
  socialAuthorization?: {
    granted: boolean;
    authorizerName?: string;
    authorizerRole?: string;
    relationship?: SocialAuthorizerRelationship;
    monetizationAcknowledged?: boolean;
    acceptedVersion?: string;
  };
}

/* ── Step 0: Type & Basics ───────────────────────────────── */

function validateStep0(v: TourismFormValues, errors: Record<string, string>) {
  if (v.title.trim().length < 5) {
    errors.title = "Title must be at least 5 characters.";
  } else if (v.title.length > 120) {
    errors.title = "Title cannot exceed 120 characters.";
  }

  if (v.description.trim().length < 20) {
    errors.description = "Description must be at least 20 characters.";
  } else if (v.description.length > 5000) {
    errors.description = "Description cannot exceed 5 000 characters.";
  }

  if (v.listingType === "tourism_business" && !v.subcategory) {
    errors.subcategory = "Select a tourism subcategory.";
  }

  if (v.listingType === "event" && !v.eventType) {
    errors.eventType = "Select an event type.";
  }
}

/* ── Step 1: Details ─────────────────────────────────────── */

function validateStep1Tourism(v: TourismFormValues, errors: Record<string, string>) {
  const group = TOURISM_SUBCATEGORY_FIELD_GROUPS[v.subcategory] ?? "A";

  // Accommodation fields (Groups A & B)
  if (group === "A" || group === "B") {
    if (v.starRating) {
      const n = Number(v.starRating);
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        errors.starRating = "Star rating must be between 1 and 5.";
      }
    }
    if (v.numberOfRooms) {
      const n = Number(v.numberOfRooms);
      if (!Number.isFinite(n) || n < 0) {
        errors.numberOfRooms = "Number of rooms must be 0 or more.";
      }
    }
  }

  // Booking URL (all groups)
  if (v.bookingUrl.trim() && !isValidUrl(v.bookingUrl.trim())) {
    errors.bookingUrl = "Enter a valid booking URL.";
  }

  // Tours & Safaris (Group C)
  if (group === "C") {
    if (v.maxGroupSize) {
      const n = Number(v.maxGroupSize);
      if (!Number.isFinite(n) || n < 1) {
        errors.maxGroupSize = "Group size must be at least 1.";
      }
    }
    if (v.whatsIncluded && v.whatsIncluded.length > 2000) {
      errors.whatsIncluded = "What's included cannot exceed 2 000 characters.";
    }
  }

  // Car Rental (Group F)
  if (group === "F") {
    if (v.minDriverAge) {
      const n = Number(v.minDriverAge);
      if (!Number.isFinite(n) || n < 16 || n > 99) {
        errors.minDriverAge = "Minimum driver age must be between 16 and 99.";
      }
    }
  }
}

function validateStep1Event(v: TourismFormValues, errors: Record<string, string>) {
  if (!v.startDate) {
    errors.startDate = "Start date is required.";
  } else if (Number.isNaN(new Date(v.startDate).getTime())) {
    errors.startDate = "Enter a valid start date.";
  }

  if (v.endDate) {
    if (Number.isNaN(new Date(v.endDate).getTime())) {
      errors.endDate = "Enter a valid end date.";
    } else if (v.startDate) {
      const start = new Date(v.startDate);
      const end = new Date(v.endDate);
      if (!Number.isNaN(start.getTime()) && end < start) {
        errors.endDate = "End date must be on or after the start date.";
      }
    }
  }

  if (v.priceZar.trim()) {
    const numericPrice = Number(v.priceZar);
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      errors.priceZar = "Enter a valid price.";
    } else if (!hasValidMoneyPrecision(numericPrice)) {
      errors.priceZar = "Price can have at most 2 decimal places.";
    }
  }

  if (v.venueCapacity) {
    const n = Number(v.venueCapacity);
    if (!Number.isFinite(n) || n < 0) {
      errors.venueCapacity = "Venue capacity must be 0 or more.";
    }
  }

  if (v.ticketsUrl.trim() && !isValidUrl(v.ticketsUrl.trim())) {
    errors.ticketsUrl = "Enter a valid ticketing URL.";
  }
}

/* ── Step 2: Location & Contact ──────────────────────────── */

function validateStep2(v: TourismFormValues, errors: Record<string, string>) {
  if (!v.province) errors.province = "Province is required.";
  if (!v.city) errors.city = "City is required.";

  if (v.listingType === "tourism_business") {
    if (!v.locationAddress?.trim()) {
      errors.locationAddress = "Street address is required for tourism businesses.";
    }
    if (!v.locationTown?.trim()) {
      errors.locationTown = "Suburb / town is required for tourism businesses.";
    }
  }

  if (v.contactMethods.length === 0) {
    errors.contactMethods = "Choose at least one contact method.";
  }

  if (v.phone && !SA_PHONE_REGEX.test(v.phone.trim())) {
    errors.phone = "Enter a valid South African number.";
  }

  if (v.whatsapp && !SA_PHONE_REGEX.test(v.whatsapp.trim())) {
    errors.whatsapp = "Enter a valid South African WhatsApp number.";
  }

  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (v.website && !isValidUrl(v.website.trim())) {
    errors.website = "Enter a valid website URL.";
  }

  const socialFields: Array<[keyof TourismFormValues, string]> = [
    ["socialFacebook", "Enter a valid Facebook URL."],
    ["socialInstagram", "Enter a valid Instagram URL."],
    ["socialTwitter", "Enter a valid X / Twitter URL."],
    ["socialTiktok", "Enter a valid TikTok URL."],
  ];

  for (const [field, message] of socialFields) {
    const rawValue = v[field];
    if (typeof rawValue === "string" && rawValue.trim() && !isValidUrl(rawValue.trim())) {
      errors[field] = message;
    }
  }
}

/* ── Step 3: Media & Review ──────────────────────────────── */

function validateStep3(v: TourismFormValues, errors: Record<string, string>, imageCount: number) {
  if (imageCount < 1) {
    errors.images = "Upload at least 1 photo.";
  }
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Validate a single step of the tourism / event creation form.
 * Returns an error map (empty = valid).
 */
export function validateTourismStep(
  step: number,
  values: TourismFormValues,
  /** Number of uploaded images (checked on step 3) */
  imageCount = 0
): Record<string, string> {
  const errors: Record<string, string> = {};

  switch (step) {
    case 0:
      validateStep0(values, errors);
      break;
    case 1:
      if (values.listingType === "tourism_business") {
        validateStep1Tourism(values, errors);
      } else {
        validateStep1Event(values, errors);
      }
      break;
    case 2:
      validateStep2(values, errors);
      break;
    case 3:
      validateStep3(values, errors, imageCount);
      break;
  }

  return errors;
}

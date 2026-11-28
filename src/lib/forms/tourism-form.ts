import type {
  TourismCategorySpecificFormFields,
  TourismListingType,
} from "@/types/tourism-details";
import { TOURISM_SUBCATEGORY_FIELD_GROUPS } from "@/lib/constants/categories";
import { eventTimeToIso } from "./event-time";
import { PHOTO_OR_VIDEO_RULE, VIDEO_COVER_NEEDED } from "./video-cover-photo";
import { isValidUserEnteredUrl } from "@/lib/utils/external-url";
import { BUSINESS_TEXT_LIMITS } from "@/lib/validations/business-limits";

/* ── Regex ───────────────────────────────────────────────── */

function hasValidMoneyPrecision(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 0.001;
}

/* ── Form value interfaces ───────────────────────────────── */

export interface TourismFormValues extends TourismCategorySpecificFormFields {
  /* shared */
  listingType: TourismListingType;
  title: string;
  description: string;
  province: string;
  city: string;
  locationAddress?: string;
  locationTown?: string;
  joinMethods?: string[];
  meetingPoint?: string;
  pickupAreas?: string;
  contactMethods: string[];

  /* tourism business */
  subcategory: string;
  /** Older drafts only: the form keeps only TGCSA grading. */
  starRating: string;
  numberOfRooms: string;
  bookingUrl: string;
  languagesSpoken: string;
  /** "From R___" price in rand, as typed. */
  priceFrom?: string;
  /** Stays: whole numbers, as typed. */
  sleeps?: string;
  bedrooms?: string;
  beds?: string;
  bathrooms?: string;
  cancellationPolicy?: string;
  cancellationFreeDays?: string;
  /** Attractions: free-text opening hours. */
  openingHours?: string;
  /**
   * The account's verified number, used for Call and WhatsApp (nothing is
   * typed). Empty when the account has none.
   */
  phone: string;
  whatsapp: string;
  website: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTwitter: string;
  socialTiktok: string;
  socialYoutube?: string;
  /** Google Maps share link for the venue or premises */
  mapDirections?: string;

  /* event */
  eventType: string;
  startDate: string;
  endDate: string;
  priceZar: string;
  venueName: string;
  venueCapacity: string;
  ticketsUrl: string;
  /** "HH:MM" */
  doorsOpen?: string;
  refundPolicy?: string;
  refundDays?: string;
}

/** Whole number of at least `min`, or an error message. */
function wholeNumberError(value: string | undefined, label: string, min: number): string | null {
  if (!value?.trim()) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) return `${label} must be a whole number of ${min} or more.`;
  return null;
}

/* ── Step 0: Type & Basics ───────────────────────────────── */

function validateStep0(v: TourismFormValues, errors: Record<string, string>) {
  const isBusiness = v.listingType === "tourism_business";
  const maxTitleLength = isBusiness ? BUSINESS_TEXT_LIMITS.name : 120;
  const maxDescriptionLength = isBusiness ? BUSINESS_TEXT_LIMITS.description : 5000;
  // The business API trims these fields before checking their bounds.
  const title = isBusiness ? v.title.trim() : v.title;
  const description = isBusiness ? v.description.trim() : v.description;

  if (v.title.trim().length < 5) {
    errors.title = "Title must be at least 5 characters.";
  } else if (title.length > maxTitleLength) {
    errors.title = `Title cannot exceed ${maxTitleLength} characters.`;
  }

  if (v.description.trim().length < 20) {
    errors.description = "Description must be at least 20 characters.";
  } else if (description.length > maxDescriptionLength) {
    errors.description = `Description cannot exceed ${isBusiness ? "3 000" : "5 000"} characters.`;
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

  // Stays: guests and rooms
  if (group === "A") {
    for (const [key, label, min] of [
      ["sleeps", "Sleeps", 1],
      ["bedrooms", "Bedrooms", 0],
      ["beds", "Beds", 0],
      ["bathrooms", "Bathrooms", 0],
    ] as const) {
      const message = wholeNumberError(v[key], label, min);
      if (message) errors[key] = message;
    }
  }

  // "From R___" price (all groups)
  if (v.priceFrom?.trim()) {
    const price = Number(v.priceFrom);
    if (!Number.isFinite(price) || price <= 0) {
      errors.priceFrom = "Enter a price above R0, or leave it blank.";
    } else if (!hasValidMoneyPrecision(price)) {
      errors.priceFrom = "Price can have at most 2 decimal places.";
    }
  }

  if (v.cancellationPolicy === "free_until_days") {
    const days = Number(v.cancellationFreeDays);
    if (!v.cancellationFreeDays?.trim() || !Number.isInteger(days) || days < 1 || days > 365) {
      errors.cancellationFreeDays = "Enter the number of days (1 to 365).";
    }
  }

  if (group === "E" && (v.openingHours?.length ?? 0) > 120) {
    errors.openingHours = "Opening hours cannot exceed 120 characters.";
  }

  // Booking URL (all groups)
  if (v.bookingUrl.trim() && !isValidUserEnteredUrl(v.bookingUrl)) {
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
  if (v.startDate && !v.startDate.includes("T")) errors.startDate = "Choose a start time (SAST).";
  if (!v.startDate) {
    errors.startDate = "Start date is required.";
  } else if (Number.isNaN(new Date(v.startDate).getTime())) {
    errors.startDate = "Enter a valid start date.";
  }

  if (v.endDate) {
    if (Number.isNaN(new Date(v.endDate).getTime())) {
      errors.endDate = "Enter a valid end date.";
    } else if (v.startDate) {
      const start = new Date(eventTimeToIso(v.startDate));
      const end = new Date(eventTimeToIso(v.endDate, true));
      if (
        !Number.isNaN(start.getTime()) &&
        (end < start || (v.endDate.includes("T") && end.getTime() === start.getTime()))
      ) {
        errors.endDate = "The event must end after it starts.";
      }
    }
  }

  if (!v.priceZar.trim()) errors.priceZar = "Choose free entry or enter a starting entry price.";
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

  if (v.ticketsUrl.trim() && !isValidUserEnteredUrl(v.ticketsUrl)) {
    errors.ticketsUrl = "Enter a valid ticketing URL.";
  }

  if (v.doorsOpen && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.doorsOpen)) {
    errors.doorsOpen = "Choose a doors-open time.";
  }

  if (Number(v.priceZar) > 0 && v.refundPolicy === "full_until_days") {
    const days = Number(v.refundDays);
    if (!v.refundDays?.trim() || !Number.isInteger(days) || days < 1 || days > 365) {
      errors.refundDays = "Enter the number of days (1 to 365).";
    }
  }
}

/* ── Step 2: Location & Contact ──────────────────────────── */

function validateStep2(v: TourismFormValues, errors: Record<string, string>) {
  if (!v.province) errors.province = "Province is required.";
  if (!v.city) errors.city = "City is required.";

  if (
    v.listingType === "tourism_business" &&
    TOURISM_SUBCATEGORY_FIELD_GROUPS[v.subcategory] === "C"
  ) {
    const methods = v.joinMethods ?? [];
    if (methods.length === 0) errors.joinMethods = "Choose at least one way visitors join you.";
    if (methods.includes("meeting_point") && !v.meetingPoint?.trim()) {
      errors.meetingPoint =
        "Describe where visitors meet you, or deselect the meeting point option.";
    }
    if (methods.includes("pickup") && !v.pickupAreas?.split(",").some((area) => area.trim())) {
      errors.pickupAreas = "Add at least one pickup area, or deselect the pickup option.";
    }
  }

  // Call and WhatsApp use the account's verified number: nothing is typed.
  const usesNumber = v.contactMethods.some((method) => method === "call" || method === "whatsapp");
  if (v.contactMethods.length === 0) {
    errors.contactMethods = "Choose at least one contact method.";
  } else if (usesNumber && !v.phone.trim()) {
    errors.contactMethods = "Verify a number on your account to use Call or WhatsApp.";
  }

  validateOnlinePresence(v, errors);
}

/** Website, map pin and social links are collected for businesses and events. */
function validateOnlinePresence(v: TourismFormValues, errors: Record<string, string>) {
  if (v.website && !isValidUserEnteredUrl(v.website)) {
    errors.website = "Enter a valid website URL.";
  }

  if (v.mapDirections?.trim() && !isValidUserEnteredUrl(v.mapDirections)) {
    errors.mapDirections = "Enter a valid map link, e.g. a Google Maps share link.";
  }

  const socialFields: Array<[keyof TourismFormValues, string]> = [
    ["socialFacebook", "Enter a valid Facebook URL."],
    ["socialInstagram", "Enter a valid Instagram URL."],
    ["socialTwitter", "Enter a valid X / Twitter URL."],
    ["socialTiktok", "Enter a valid TikTok URL."],
    ["socialYoutube", "Enter a valid YouTube URL."],
  ];

  for (const [field, message] of socialFields) {
    const rawValue = v[field];
    if (typeof rawValue === "string" && rawValue.trim() && !isValidUserEnteredUrl(rawValue)) {
      errors[field] = message;
    }
  }
}

/* ── Step 3: Media & Review ──────────────────────────────── */

function validateStep3(
  v: TourismFormValues,
  errors: Record<string, string>,
  imageCount: number,
  videoCount: number,
  videoCoverCount: number
) {
  // A video alone is enough: its chosen cover frame becomes the first photo.
  if (imageCount < 1 && videoCount < 1) {
    errors.images = PHOTO_OR_VIDEO_RULE;
    return;
  }
  // A tourism business needs a real photo, so a video without a cover frame is not enough.
  if (v.listingType === "tourism_business" && imageCount < 1 && videoCoverCount < 1) {
    errors.video_thumbnail = VIDEO_COVER_NEEDED;
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
  imageCount = 0,
  videoCount = 0,
  /** Number of captured video cover frames */
  videoCoverCount = 0
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
      validateStep3(values, errors, imageCount, videoCount, videoCoverCount);
      break;
  }

  return errors;
}

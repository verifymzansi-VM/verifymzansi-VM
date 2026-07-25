/**
 * Browser-local draft persistence for create-post wizards.
 *
 * Stores serializable field values (text, selects, dates, step index) in
 * localStorage so users can resume an incomplete form after refresh / crash.
 * File objects are intentionally excluded — only text/choice data is persisted.
 */

import type { TourismCategorySpecificFormFields } from "@/types/tourism-details";

const STORAGE_VERSION = 1;
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/* ------------------------------------------------------------------ */
/*  Draft envelope – wraps any flow-specific payload                   */
/* ------------------------------------------------------------------ */

export interface DraftEnvelope<T> {
  v: number;
  savedAt: number; // Date.now()
  step: number;
  data: T;
}

/* ------------------------------------------------------------------ */
/*  Flow-specific draft shapes                                         */
/* ------------------------------------------------------------------ */

export interface ListingDraftData {
  category: string;
  condition: string;
  categoryAttributes: Record<string, string | boolean | string[]>;
  title: string;
  description: string;
  price: string;
  negotiable: boolean;
  province: string;
  city: string;
  town: string;
  address: string;
  contactMethods: string[];
}

export interface BusinessDraftData {
  businessType: string;
  businessName: string;
  slug: string;
  slugManual: boolean;
  description: string;
  category: string;
  subcategory?: string;
  categoryDetails?: Record<string, unknown>;
  province: string;
  city: string;
  locationTown: string;
  locationAddress: string;
  storeNumber: string;
  serviceAreasInput: string;
  mapDirections: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  hoursMonFri: string;
  hoursSat: string;
  hoursSun: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTwitter: string;
  socialTiktok: string;
  servicesInput: string;
  services: string[];
  paymentMethods: string[];
  deliveryOptions: string[];
  businessDetails: Record<string, unknown> | null;
  selectedLayout: string;
}

export interface TourismDraftData extends TourismCategorySpecificFormFields {
  listingType: string;
  title: string;
  description: string;
  subcategory: string;
  starRating: string;
  numberOfRooms: string;
  accommodationTypes: string[];
  checkInTime: string;
  checkOutTime: string;
  priceRange: string;
  amenities: string[];
  mealOptions: string[];
  languagesSpoken: string;
  cancellationPolicy: string;
  bookingUrl: string;
  petsAllowed: boolean;
  smokingAllowed: boolean;
  eventType: string;
  startDate: string;
  endDate: string;
  priceZar: string;
  negotiable: boolean;
  venueName: string;
  venueCapacity: string;
  ticketTiers: Array<{ name: string; price_cents: number | null }>;
  ticketsUrl: string;
  ageRestriction: string;
  dressCode: string;
  lineup: string;
  parkingAvailable: boolean;
  accessibility: string[];
  foodDrinksAvailable: boolean;
  bringYourOwn: string;
  province: string;
  city: string;
  locationTown: string;
  locationAddress: string;
  contactMethods: string[];
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  hoursMonFri: string;
  hoursSat: string;
  hoursSun: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTwitter: string;
  socialTiktok: string;
  businessId: string;
}

/* ------------------------------------------------------------------ */
/*  Key helpers – include a user qualifier to prevent cross-user leak  */
/* ------------------------------------------------------------------ */

export type DraftFlow = "listing" | "promotion" | "business" | "tourism";

function storageKey(flow: DraftFlow, userId: string): string {
  return `vm-draft:${flow}:${userId}`;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function saveDraft<T>(flow: DraftFlow, userId: string, step: number, data: T): void {
  try {
    const envelope: DraftEnvelope<T> = {
      v: STORAGE_VERSION,
      savedAt: Date.now(),
      step,
      data,
    };
    localStorage.setItem(storageKey(flow, userId), JSON.stringify(envelope));
  } catch {
    // localStorage full or unavailable – silently degrade.
  }
}

export function loadDraft<T>(flow: DraftFlow, userId: string): DraftEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(storageKey(flow, userId));
    if (!raw) return null;

    const envelope: DraftEnvelope<T> = JSON.parse(raw);

    // Version mismatch → discard
    if (envelope.v !== STORAGE_VERSION) {
      clearDraft(flow, userId);
      return null;
    }

    // Expired → discard
    if (Date.now() - envelope.savedAt > DRAFT_TTL_MS) {
      clearDraft(flow, userId);
      return null;
    }

    return envelope;
  } catch {
    clearDraft(flow, userId);
    return null;
  }
}

export function clearDraft(flow: DraftFlow, userId: string): void {
  try {
    localStorage.removeItem(storageKey(flow, userId));
  } catch {
    // Ignore
  }
}

import {
  BUSINESS_DETAILS_SECTIONS,
  coerceBusinessDetails,
  type BusinessDetailsFieldConfig,
} from "./business-type-details";
import type { BusinessDetails } from "@/types/business-details";
import type { BusinessType } from "@/types/enums";
import { isValidUserEnteredUrl } from "@/lib/utils/external-url";
import { businessNumber, WHATSAPP_NEEDS_MOBILE } from "@/lib/utils/phone";
import { PAYMENT_METHODS, VISITOR_FEATURES } from "./business-choices";

export interface BusinessFormValues {
  businessType: BusinessType | "";
  businessDetails: BusinessDetails | null;
  storeNumber: string;
  mapDirections: string;
  phone: string;
  whatsapp: string;
  website: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTwitter: string;
  socialTiktok: string;
  socialYoutube?: string;
}

function validateDetailsField(
  field: BusinessDetailsFieldConfig,
  value: unknown,
  errors: Record<string, string>
) {
  const path = `business_details.${field.name}`;

  if (field.required) {
    if (field.kind === "list" && (!Array.isArray(value) || value.length === 0)) {
      errors[path] = `${field.label} is required.`;
      return;
    }
    if (field.kind === "select" && typeof value !== "string") {
      errors[path] = `${field.label} is required.`;
      return;
    }
    if (field.kind !== "checkbox" && field.kind !== "list" && `${value ?? ""}`.trim() === "") {
      errors[path] = `${field.label} is required.`;
      return;
    }
  }

  if (
    field.kind === "url" &&
    typeof value === "string" &&
    value.trim() &&
    !isValidUserEnteredUrl(value)
  ) {
    errors[path] = `Enter a valid ${field.label.toLowerCase()}.`;
  }

  if (
    field.kind === "number" &&
    value !== undefined &&
    value !== null &&
    (typeof value !== "number" ||
      Number.isNaN(value) ||
      (field.min !== undefined && value < field.min))
  ) {
    errors[path] = `${field.label} must be ${field.min ?? 0} or more.`;
  }
}

export function validateBusinessForm(values: BusinessFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  if (values.businessType === "mall_store" && !values.storeNumber.trim()) {
    errors.store_number = "Store number is required for mall stores.";
  }

  if (
    values.businessType &&
    ["mall_store", "standalone_shop", "home_business", "market_stall"].includes(
      values.businessType
    ) &&
    values.mapDirections.trim() &&
    !isValidUserEnteredUrl(values.mapDirections)
  ) {
    errors.map_directions = "Enter a valid map directions URL.";
  }

  if (values.businessType) {
    const details = coerceBusinessDetails(values.businessType, values.businessDetails);
    for (const field of BUSINESS_DETAILS_SECTIONS[values.businessType].fields) {
      validateDetailsField(
        field,
        (details as unknown as Record<string, unknown>)[field.name],
        errors
      );
    }
  }

  if (values.phone && !businessNumber(values.phone.trim())) {
    errors.phone = "Enter a valid South African number.";
  }

  const whatsapp = values.whatsapp ? businessNumber(values.whatsapp.trim()) : undefined;
  if (whatsapp === null) errors.whatsapp = "Enter a valid South African WhatsApp number.";
  else if (whatsapp && whatsapp.kind !== "mobile") errors.whatsapp = WHATSAPP_NEEDS_MOBILE;

  if (values.website && !isValidUserEnteredUrl(values.website)) {
    errors.website = "Enter a valid website URL.";
  }

  const socialFields: Array<[keyof BusinessFormValues, string]> = [
    ["socialFacebook", "Enter a valid Facebook URL."],
    ["socialInstagram", "Enter a valid Instagram URL."],
    ["socialTwitter", "Enter a valid X / Twitter URL."],
    ["socialTiktok", "Enter a valid TikTok URL."],
    ["socialYoutube", "Enter a valid YouTube URL."],
  ];

  for (const [field, message] of socialFields) {
    const rawValue = values[field];
    if (typeof rawValue === "string" && rawValue.trim() && !isValidUserEnteredUrl(rawValue)) {
      errors[field] = message;
    }
  }

  return errors;
}

/* ── Payment methods ───────────────────────────────────── */

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Plain labels for every payment method, in the order the forms show them. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  eft: "EFT / Bank transfer",
  snapscan: "SnapScan",
  capitec_pay: "Capitec Pay",
  zapper: "Zapper",
  card_machine: "Card machine",
  cash_on_delivery: "Cash on delivery",
  instant_eft: "Instant EFT",
  other: "Other",
};

export const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((value) => ({
  value,
  label: PAYMENT_METHOD_LABELS[value],
}));

/* ── Visit facts (business_details) ────────────────────── */

export type VisitorFeature = (typeof VISITOR_FEATURES)[number];

export const VISITOR_FEATURE_LABELS: Record<VisitorFeature, string> = {
  parking: "Parking",
  wheelchair_access: "Wheelchair access",
  kid_friendly: "Kid-friendly",
};

export const VISITOR_FEATURE_OPTIONS = VISITOR_FEATURES.map((value) => ({
  value,
  label: VISITOR_FEATURE_LABELS[value],
}));

export type WalkInPolicyValue = "walk_ins_welcome" | "appointments_preferred" | "appointment_only";
export interface VisitDetails {
  /** "" when not set. Older shops may hold the two appointment answers. */
  walkInPolicy: WalkInPolicyValue | "";
  visitorFeatures: VisitorFeature[];
}

const WALK_IN_VALUES = new Set(["walk_ins_welcome", "appointments_preferred", "appointment_only"]);
const VISIT_KEYS = new Set(["type", "walk_in_policy", "visitor_features"]);

/** The walk-in answer and visitor features stored in business_details. */
export function readVisitDetails(details: unknown): VisitDetails {
  const record = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const policy = record.walk_in_policy;
  const features = Array.isArray(record.visitor_features) ? record.visitor_features : [];
  return {
    walkInPolicy:
      typeof policy === "string" && WALK_IN_VALUES.has(policy) ? (policy as WalkInPolicyValue) : "",
    visitorFeatures: VISITOR_FEATURES.filter((feature) => features.includes(feature)),
  };
}

/** True when business_details holds only the visit facts, not the older address details. */
export function isVisitOnlyDetails(details: unknown): boolean {
  return (
    !!details &&
    typeof details === "object" &&
    Object.keys(details).every((key) => VISIT_KEYS.has(key))
  );
}

/**
 * business_details to submit: the given details (or just the type) with the
 * visit facts set, or undefined when there is nothing to store.
 */
export function withVisitDetails(
  details: Record<string, unknown> | null | undefined,
  type: string,
  visit: VisitDetails
): Record<string, unknown> | undefined {
  const {
    walk_in_policy: _policy,
    visitor_features: _features,
    ...rest
  } = details && details.type === type ? details : { type };
  const out: Record<string, unknown> = { ...rest, type };
  if (visit.walkInPolicy) out.walk_in_policy = visit.walkInPolicy;
  if (visit.visitorFeatures.length > 0) out.visitor_features = visit.visitorFeatures;
  return Object.keys(out).length > 1 ? out : undefined;
}

/* ── Opening hours (operating_hours) ───────────────────── */

export interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

export interface BusinessHours {
  monFri: DayHours;
  sat: DayHours;
  sun: DayHours;
  publicHolidays: DayHours;
  open24: boolean;
  byAppointment: boolean;
}

export const BUSINESS_HOURS_GROUPS = [
  { key: "monFri", stored: "Mon_Fri", label: "Mon – Fri" },
  { key: "sat", stored: "Sat", label: "Saturday" },
  { key: "sun", stored: "Sun", label: "Sunday" },
  { key: "publicHolidays", stored: "Public_holidays", label: "Public holidays" },
] as const;

const EMPTY_DAY: DayHours = { open: "", close: "", closed: false };

export const EMPTY_BUSINESS_HOURS: BusinessHours = {
  monFri: EMPTY_DAY,
  sat: EMPTY_DAY,
  sun: { ...EMPTY_DAY, closed: true },
  publicHolidays: EMPTY_DAY,
  open24: false,
  byAppointment: false,
};

/** "08:00 - 17:00", "Closed", or "" while a time is missing. */
function dayHoursText(day: DayHours): string {
  if (day.closed) return "Closed";
  return day.open && day.close ? `${day.open} - ${day.close}` : "";
}

const pad = (time: string) => (time.length === 4 ? `0${time}` : time);

/** Reads one stored line ("08:00 - 17:00", "8:00-17:30", "Closed"); anything else is empty. */
export function parseDayHours(raw: unknown): DayHours {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (/^closed$/i.test(text)) return { open: "", close: "", closed: true };
  const match = text.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  return match ? { open: pad(match[1]), close: pad(match[2]), closed: false } : EMPTY_DAY;
}

/** Form state from stored operating_hours (older "By appointment" lines become the flag). */
export function readBusinessHours(raw: unknown): BusinessHours {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const appointmentLine = BUSINESS_HOURS_GROUPS.some(
    ({ stored }) =>
      typeof record[stored] === "string" &&
      /^(by appointment|appointment.only)$/i.test((record[stored] as string).trim())
  );
  return {
    monFri: parseDayHours(record.Mon_Fri),
    sat: parseDayHours(record.Sat),
    sun: parseDayHours(record.Sun),
    publicHolidays: parseDayHours(record.Public_holidays),
    open24: record.Open_24_hours === true,
    byAppointment: record.By_appointment === true || appointmentLine,
  };
}

/** operating_hours to submit; open 24 hours replaces the day lines. */
export function businessHoursPayload(hours: BusinessHours): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (hours.open24) out.Open_24_hours = true;
  else
    for (const { key, stored } of BUSINESS_HOURS_GROUPS) {
      const text = dayHoursText(hours[key]);
      if (text) out[stored] = text;
    }
  if (hours.byAppointment) out.By_appointment = true;
  return out;
}

import type { BusinessDetails, PrimaryOrderChannel, WalkInPolicy } from "@/types/business-details";
import type { BusinessType } from "@/types/enums";

export interface SelectOption {
  value: string;
  label: string;
}

export type BusinessDetailsFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "url"
  | "checkbox"
  | "list"
  | "select"
  | "time_range"
  | "day_select";

export interface BusinessDetailsFieldConfig {
  name: string;
  label: string;
  kind: BusinessDetailsFieldKind;
  description?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  step?: string;
  options?: SelectOption[];
}

export interface BusinessDetailsSectionConfig {
  title: string;
  description: string;
  fields: BusinessDetailsFieldConfig[];
}

const FLOOR_OR_WING_OPTIONS: SelectOption[] = [
  { value: "Ground Floor", label: "Ground Floor" },
  { value: "1st Floor", label: "1st Floor" },
  { value: "2nd Floor", label: "2nd Floor" },
  { value: "3rd Floor", label: "3rd Floor" },
  { value: "Upper Level", label: "Upper Level" },
  { value: "Basement", label: "Basement" },
  { value: "North Wing", label: "North Wing" },
  { value: "South Wing", label: "South Wing" },
  { value: "East Wing", label: "East Wing" },
  { value: "West Wing", label: "West Wing" },
];

const SUPPORT_RESPONSE_TIME_OPTIONS: SelectOption[] = [
  { value: "Within 1 hour", label: "Within 1 hour" },
  { value: "Within 2 hours", label: "Within 2 hours" },
  { value: "Within 4 hours", label: "Within 4 hours" },
  { value: "Same day", label: "Same day" },
  { value: "Next business day", label: "Next business day" },
  { value: "Within 2-3 days", label: "Within 2-3 days" },
];

export const DAYS_OF_WEEK: SelectOption[] = [
  { value: "Monday", label: "Monday" },
  { value: "Tuesday", label: "Tuesday" },
  { value: "Wednesday", label: "Wednesday" },
  { value: "Thursday", label: "Thursday" },
  { value: "Friday", label: "Friday" },
  { value: "Saturday", label: "Saturday" },
  { value: "Sunday", label: "Sunday" },
];

const WALK_IN_POLICY_OPTIONS: SelectOption[] = [
  { value: "walk_ins_welcome", label: "Walk-ins welcome" },
  { value: "appointments_preferred", label: "Appointments preferred" },
  { value: "appointment_only", label: "Appointment only" },
];

const PRIMARY_ORDER_CHANNEL_OPTIONS: SelectOption[] = [
  { value: "website", label: "Website" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "marketplace", label: "Marketplace" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "other", label: "Other" },
];

export const WALK_IN_POLICY_LABELS: Record<WalkInPolicy, string> = {
  walk_ins_welcome: "Walk-ins welcome",
  appointments_preferred: "Appointments preferred",
  appointment_only: "Appointment only",
};

export const PRIMARY_ORDER_CHANNEL_LABELS: Record<PrimaryOrderChannel, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  marketplace: "Marketplace",
  phone: "Phone",
  email: "Email",
  other: "Other",
};

export const BUSINESS_DETAILS_SECTIONS: Record<BusinessType, BusinessDetailsSectionConfig> = {
  mall_store: {
    title: "Mall Store Details",
    description: "Add the mall name and the access cues customers can use once they arrive.",
    fields: [
      {
        name: "mall_name",
        label: "Mall name",
        kind: "text",
        required: true,
        placeholder: "e.g. Maponya Mall",
      },
      {
        name: "mall_address",
        label: "Mall address",
        kind: "textarea",
        placeholder: "e.g. 2127 Chris Hani Rd, Soweto",
      },
      {
        name: "mall_summary",
        label: "Mall information",
        kind: "textarea",
        placeholder: "Optional notes about the mall, access, or amenities.",
      },
      {
        name: "floor_or_wing",
        label: "Floor or wing",
        kind: "select",
        options: FLOOR_OR_WING_OPTIONS,
      },
      {
        name: "nearest_entrance",
        label: "Nearest entrance",
        kind: "text",
        placeholder: "e.g. Entrance 3 near Woolworths",
      },
      {
        name: "parking_notes",
        label: "Parking notes",
        kind: "textarea",
        placeholder: "Best parking area, pickup bay notes, or mall access tips.",
      },
    ],
  },
  standalone_shop: {
    title: "Own Premises Details",
    description: "Show the exact location and what customers should expect when arriving.",
    fields: [
      {
        name: "building_name",
        label: "Building / complex name",
        kind: "text",
        placeholder: "e.g. Braamfontein Centre (leave blank if none)",
      },
      {
        name: "suite_or_unit",
        label: "Suite / unit number",
        kind: "text",
        placeholder: "e.g. Suite 204",
      },
      {
        name: "street_address",
        label: "Street address",
        kind: "text",
        required: true,
        placeholder: "e.g. 24 Vilakazi Street",
      },
      {
        name: "suburb",
        label: "Suburb",
        kind: "text",
        required: true,
        placeholder: "e.g. Orlando West",
      },
      {
        name: "landmark",
        label: "Landmark",
        kind: "text",
        placeholder: "e.g. Opposite the taxi rank",
      },
      {
        name: "walk_in_policy",
        label: "Walk-in policy",
        kind: "select",
        options: WALK_IN_POLICY_OPTIONS,
      },
    ],
  },
  home_business: {
    title: "Home Business Details",
    description: "Only share suburb-level access details that are safe to show publicly.",
    fields: [
      {
        name: "service_suburb",
        label: "Service suburb",
        kind: "text",
        required: true,
        placeholder: "e.g. Noordwyk",
      },
      {
        name: "appointment_required",
        label: "Appointment required",
        kind: "checkbox",
      },
      {
        name: "customer_pickup_allowed",
        label: "Customer pickup allowed",
        kind: "checkbox",
      },
      {
        name: "visitor_notes",
        label: "Visitor notes",
        kind: "textarea",
        placeholder:
          "Share gate, security, or appointment notes without revealing your street address.",
      },
    ],
  },
  mobile_service: {
    title: "Mobile Service Details",
    description: "Explain how far you travel and what clients should expect for callouts.",
    fields: [
      {
        name: "travel_radius_km",
        label: "Travel radius (km)",
        kind: "number",
        min: 0,
        step: "1",
        placeholder: "e.g. 25",
      },
      {
        name: "callout_fee_from",
        label: "Callout fee from (R)",
        kind: "number",
        min: 0,
        step: "1",
        placeholder: "e.g. 350",
      },
      {
        name: "emergency_callouts",
        label: "Emergency callouts available",
        kind: "checkbox",
      },
    ],
  },
  online_only: {
    title: "Online Business Details",
    description: "Tell customers where to order and how support works.",
    fields: [
      {
        name: "primary_order_channel",
        label: "Primary order channel",
        kind: "select",
        required: true,
        options: PRIMARY_ORDER_CHANNEL_OPTIONS,
      },
      {
        name: "order_url",
        label: "Order URL",
        kind: "url",
        required: true,
        placeholder: "https://...",
      },
      {
        name: "delivery_regions",
        label: "Delivery areas",
        kind: "list",
        placeholder: "e.g. Johannesburg, Pretoria, Nationwide",
        description: "Separate delivery areas with commas so customers know where you can deliver.",
      },
      {
        name: "support_response_time",
        label: "Support response time",
        kind: "select",
        options: SUPPORT_RESPONSE_TIME_OPTIONS,
      },
    ],
  },
  market_stall: {
    title: "Market Stall Details",
    description: "Help visitors find your stall and know when you trade.",
    fields: [
      {
        name: "market_name",
        label: "Market name",
        kind: "text",
        required: true,
        placeholder: "e.g. Neighbourgoods Market",
      },
      {
        name: "stall_label",
        label: "Stall label",
        kind: "text",
        placeholder: "e.g. A12 near the main gate",
      },
      {
        name: "trading_days",
        label: "Trading days",
        kind: "day_select",
        required: true,
      },
      {
        name: "trading_hours",
        label: "Trading hours",
        kind: "time_range",
        required: true,
        placeholder: "e.g. 09:00 - 16:00",
      },
    ],
  },
};

export function getDefaultBusinessDetails(type: BusinessType): BusinessDetails {
  switch (type) {
    case "mall_store":
      return {
        type,
        mall_name: "",
        mall_address: "",
        mall_summary: "",
        mall_photos: [],
        floor_or_wing: "",
        nearest_entrance: "",
        parking_notes: "",
      };
    case "standalone_shop":
      return {
        type,
        building_name: "",
        suite_or_unit: "",
        street_address: "",
        suburb: "",
        landmark: "",
        walk_in_policy: undefined,
      };
    case "home_business":
      return {
        type,
        service_suburb: "",
        appointment_required: false,
        customer_pickup_allowed: false,
        visitor_notes: "",
      };
    case "mobile_service":
      return {
        type,
        travel_radius_km: undefined,
        callout_fee_from: undefined,
        emergency_callouts: false,
      };
    case "online_only":
      return {
        type,
        primary_order_channel: undefined,
        order_url: "",
        delivery_regions: [],
        support_response_time: "",
      };
    case "market_stall":
      return { type, market_name: "", stall_label: "", trading_days: [], trading_hours: "" };
  }
}

export function coerceBusinessDetails(type: BusinessType, value: unknown): BusinessDetails {
  const defaults = getDefaultBusinessDetails(type);
  if (!value || typeof value !== "object") return defaults;
  const raw = value as Record<string, unknown>;
  if (raw.type !== type) return defaults;

  return { ...defaults, ...raw } as BusinessDetails;
}

const DELIVERY_AVAILABLE_OPTIONS = new Set(["delivery", "nationwide"]);

export function hasBusinessDeliveryAvailable(
  deliveryOptions?: string[] | null,
  businessDetails?: BusinessDetails | null
): boolean {
  if ((deliveryOptions ?? []).some((option) => DELIVERY_AVAILABLE_OPTIONS.has(option))) {
    return true;
  }

  return (
    businessDetails?.type === "online_only" &&
    Array.isArray(businessDetails.delivery_regions) &&
    businessDetails.delivery_regions.length > 0
  );
}

export function getNormalizedDeliveryOptions(deliveryAvailable: boolean): string[] {
  return deliveryAvailable ? ["delivery"] : [];
}

export function sanitizeBusinessDetailsForSubmission(
  details: BusinessDetails,
  deliveryAvailable?: boolean
): BusinessDetails {
  if (details.type !== "online_only") {
    return details;
  }

  const normalizedRegions = Array.isArray(details.delivery_regions)
    ? details.delivery_regions.map((region) => region.trim()).filter(Boolean)
    : [];
  const shouldKeepDeliveryRegions = deliveryAvailable ?? normalizedRegions.length > 0;

  if (!shouldKeepDeliveryRegions || normalizedRegions.length === 0) {
    const { delivery_regions: _legacyDeliveryRegions, ...rest } = details;
    return rest as BusinessDetails;
  }

  return {
    ...details,
    delivery_regions: normalizedRegions,
  };
}

export function stringifyListValue(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

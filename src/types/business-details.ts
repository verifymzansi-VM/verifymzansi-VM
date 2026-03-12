import type { BusinessType } from "./enums";

export type WalkInPolicy = "walk_ins_welcome" | "appointments_preferred" | "appointment_only";

export type PrimaryOrderChannel =
  | "website"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "marketplace"
  | "phone"
  | "email"
  | "other";

export interface MallStoreBusinessDetails {
  type: "mall_store";
  mall_name?: string;
  mall_address?: string;
  mall_summary?: string;
  mall_photos?: string[];
  floor_or_wing?: string;
  nearest_entrance?: string;
  parking_notes?: string;
}

export interface StandaloneShopBusinessDetails {
  type: "standalone_shop";
  street_address?: string;
  suburb?: string;
  landmark?: string;
  walk_in_policy?: WalkInPolicy;
}

export interface HomeBusinessDetails {
  type: "home_business";
  service_suburb?: string;
  appointment_required: boolean;
  customer_pickup_allowed: boolean;
  visitor_notes?: string;
}

export interface MobileServiceBusinessDetails {
  type: "mobile_service";
  travel_radius_km?: number;
  callout_fee_from?: number;
  emergency_callouts: boolean;
}

export interface OnlineOnlyBusinessDetails {
  type: "online_only";
  primary_order_channel?: PrimaryOrderChannel;
  order_url?: string;
  delivery_regions: string[];
  support_response_time?: string;
}

export interface MarketStallBusinessDetails {
  type: "market_stall";
  market_name?: string;
  stall_label?: string;
  trading_days: string[];
  trading_hours?: string;
}

export type BusinessDetails =
  | MallStoreBusinessDetails
  | StandaloneShopBusinessDetails
  | HomeBusinessDetails
  | MobileServiceBusinessDetails
  | OnlineOnlyBusinessDetails
  | MarketStallBusinessDetails;

export type PhysicalBusinessType =
  | "mall_store"
  | "standalone_shop"
  | "home_business"
  | "market_stall";

export const PHYSICAL_BUSINESS_TYPES: PhysicalBusinessType[] = [
  "mall_store",
  "standalone_shop",
  "home_business",
  "market_stall",
];

export function isPhysicalBusinessType(type: BusinessType): type is PhysicalBusinessType {
  return PHYSICAL_BUSINESS_TYPES.includes(type as PhysicalBusinessType);
}

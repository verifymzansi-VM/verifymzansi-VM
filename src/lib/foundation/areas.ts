import { z } from "zod";
import type { MarketplaceArea } from "@/types/enums";
import type { PublicCollection } from "./marketplace-read";

// One mapping between the restored website's area and content names and the
// live backend's. Adapters translate through these, never with their own
// copies, so a renamed area or kind changes in one place.

/** Areas as the restored website names them (URLs, plans, forms). */
const RESTORED_AREAS = [
  "MZANSI_MARKET",
  "MZANSI_BUSINESS",
  "PROMOTIONS_EVENTS",
] as const satisfies readonly MarketplaceArea[];
/** Areas as the live backend names them. */
export type FoundationArea = "market" | "business" | "tourism_events";

export const restoredAreaSchema = z.enum(RESTORED_AREAS);

const toFoundation = {
  MZANSI_MARKET: "market",
  MZANSI_BUSINESS: "business",
  PROMOTIONS_EVENTS: "tourism_events",
} as const satisfies Record<MarketplaceArea, FoundationArea>;
const toRestored = {
  market: "MZANSI_MARKET",
  business: "MZANSI_BUSINESS",
  tourism_events: "PROMOTIONS_EVENTS",
} as const satisfies Record<FoundationArea, MarketplaceArea>;
const labels = {
  market: "Mzansi Market",
  business: "Mzansi Business",
  tourism_events: "Tourism & Events",
} as const satisfies Record<FoundationArea, string>;

export function foundationArea(area: MarketplaceArea): FoundationArea {
  return toFoundation[area];
}
export function restoredArea(area: FoundationArea): MarketplaceArea {
  return toRestored[area];
}
/** The backend area for a restored area name from outside (a URL or form), or
 * undefined when it names none. */
export function parseRestoredArea(value: unknown): FoundationArea | undefined {
  return typeof value === "string" && Object.hasOwn(toFoundation, value)
    ? toFoundation[value as MarketplaceArea]
    : undefined;
}
export function areaLabel(area: FoundationArea): string {
  return labels[area];
}

/** Content types as the restored website names them. */
export type RestoredContentType = "listing" | "business" | "promotion";
/** Post kinds as the live backend names them. */
export type FoundationKind = "listing" | "business" | "event";

export function foundationKind(type: RestoredContentType): FoundationKind {
  return type === "promotion" ? "event" : type;
}
export function restoredContentType(kind: FoundationKind): RestoredContentType {
  return kind === "event" ? "promotion" : kind;
}

const collectionAreas = {
  listings: "MZANSI_MARKET",
  businesses: "MZANSI_BUSINESS",
  promotions: "PROMOTIONS_EVENTS",
} as const satisfies Record<PublicCollection, MarketplaceArea>;
/** The restored area a public collection's posting plans belong to. */
export function collectionArea(collection: PublicCollection): MarketplaceArea {
  return collectionAreas[collection];
}

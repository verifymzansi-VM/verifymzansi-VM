import type { BusinessCategory, BusinessType, ListingCategory } from "@/types/enums";

export type MarketProfileVariant = "property" | "motors" | "catalog" | "services";
export type BusinessProfileFamily = "showroom" | "professional" | "tourism";
export type PromotionProfileFamily = "event";

export function resolveMarketProfileVariant(
  category: ListingCategory | null | undefined
): MarketProfileVariant {
  switch (category) {
    case "property":
      return "property";
    case "vehicles":
    case "auto_parts":
      return "motors";
    case "jobs_services":
      return "services";
    default:
      return "catalog";
  }
}

export function resolveBusinessProfileFamily(
  category: BusinessCategory | null | undefined,
  businessType?: BusinessType | null,
  subcategory?: string | null
): BusinessProfileFamily {
  if (category === "tourism_hospitality") {
    return "tourism";
  }

  if (
    category === "professional_services" ||
    category === "trade_maintenance" ||
    category === "education_training" ||
    businessType === "mobile_service" ||
    subcategory === "travel_agency"
  ) {
    return "professional";
  }

  return "showroom";
}

export function resolvePromotionProfileFamily(): PromotionProfileFamily {
  return "event";
}

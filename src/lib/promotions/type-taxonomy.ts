import type { PromotionType } from "@/types/enums";

export type PromotionFilterType = "deal" | "event" | "promotion" | "ad";

export const PROMOTION_FILTER_TYPE_OPTIONS: Array<{
  value: PromotionFilterType;
  label: string;
}> = [
  { value: "deal", label: "Deals" },
  { value: "event", label: "Events" },
  { value: "promotion", label: "Promotions" },
  { value: "ad", label: "Ads" },
];

export function getPromotionFilterTypeLabel(value: PromotionFilterType): string {
  return PROMOTION_FILTER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Ads";
}

export function getPromotionFilterTypeFromStoredType(value: PromotionType): PromotionFilterType {
  switch (value) {
    case "deal":
      return "deal";
    case "event":
      return "event";
    case "product":
    case "service":
      return "promotion";
    case "general":
    default:
      return "ad";
  }
}

export function parsePromotionFilterType(
  value: string | null | undefined
): PromotionFilterType | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case "deal":
      return "deal";
    case "event":
      return "event";
    case "promotion":
    case "product":
    case "service":
      return "promotion";
    case "ad":
    case "general":
      return "ad";
    default:
      return null;
  }
}

export function getStoredPromotionTypesForFilter(value: PromotionFilterType): PromotionType[] {
  switch (value) {
    case "deal":
      return ["deal"];
    case "event":
      return ["event"];
    case "promotion":
      return ["product", "service"];
    case "ad":
    default:
      return ["general"];
  }
}

export function getStoredPromotionTypeForFilter(
  value: PromotionFilterType,
  previousType?: PromotionType
): PromotionType {
  switch (value) {
    case "deal":
      return "deal";
    case "event":
      return "event";
    case "promotion":
      return previousType === "service" ? "service" : "product";
    case "ad":
    default:
      return "general";
  }
}

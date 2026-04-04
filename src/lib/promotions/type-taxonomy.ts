import type { PromotionType } from "@/types/enums";

export type PromotionFilterType = "event";

export const PROMOTION_FILTER_TYPE_OPTIONS: Array<{
  value: PromotionFilterType;
  label: string;
}> = [{ value: "event", label: "Events" }];

export function getPromotionFilterTypeLabel(_value: PromotionFilterType): string {
  return "Events";
}

export function getPromotionFilterTypeFromStoredType(_value: PromotionType): PromotionFilterType {
  return "event";
}

export function parsePromotionFilterType(
  value: string | null | undefined
): PromotionFilterType | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "event") {
    return "event";
  }
  // Backward compat: map any old filter type to event
  if (["deal", "promotion", "product", "service", "ad", "general"].includes(normalized)) {
    return "event";
  }
  return null;
}

export function getStoredPromotionTypesForFilter(_value: PromotionFilterType): PromotionType[] {
  return ["event"];
}

export function getStoredPromotionTypeForFilter(
  _value: PromotionFilterType,
  _previousType?: PromotionType
): PromotionType {
  return "event";
}

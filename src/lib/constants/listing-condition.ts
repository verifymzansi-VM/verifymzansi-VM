import { LISTING_CONDITION_LABELS, type ListingCondition } from "@/types/enums";

export const LISTING_CONDITIONS = Object.entries(LISTING_CONDITION_LABELS).map(
  ([value, label]) => ({
    value: value as ListingCondition,
    label,
  })
);

export function getListingConditionLabel(
  condition: ListingCondition | string | null | undefined
): string | undefined {
  if (!condition) return undefined;
  return LISTING_CONDITION_LABELS[condition as ListingCondition] ?? condition.replace(/_/g, " ");
}

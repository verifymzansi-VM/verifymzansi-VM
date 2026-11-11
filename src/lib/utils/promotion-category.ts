import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import type { BusinessCategory } from "@/types/enums";

export function getPromotionCategoryDisplayLabel(
  categoryKey: BusinessCategory | null | undefined,
  freeTextCategory: string | null | undefined
): string | undefined {
  if (!categoryKey && !freeTextCategory) return undefined;

  const canonicalLabel = BUSINESS_CATEGORIES.find((item) => item.value === categoryKey)?.label;
  if (!freeTextCategory?.trim()) {
    return canonicalLabel;
  }

  const customLabel = freeTextCategory.trim();
  if (!canonicalLabel) {
    return customLabel;
  }

  return customLabel.toLowerCase() === canonicalLabel.toLowerCase()
    ? canonicalLabel
    : `${customLabel} (${canonicalLabel})`;
}

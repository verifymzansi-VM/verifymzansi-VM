import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import type { BusinessCategory, PromotionType } from "@/types/enums";

const KEYWORD_MAP: Array<{ key: BusinessCategory; patterns: RegExp[] }> = [
  {
    key: "fashion_accessories",
    patterns: [/fashion/i, /clothing/i, /apparel/i, /shoe/i, /jewell?ery/i, /boutique/i, /bag/i],
  },
  {
    key: "electronics_tech",
    patterns: [/electronic/i, /\btech\b/i, /phone/i, /laptop/i, /computer/i, /gaming/i, /gadget/i],
  },
  {
    key: "groceries_essentials",
    patterns: [/grocery/i, /supermarket/i, /essential/i, /convenience/i, /produce/i],
  },
  {
    key: "health_beauty",
    patterns: [/health/i, /beauty/i, /wellness/i, /salon/i, /spa/i, /cosmetic/i, /pharmacy/i],
  },
  {
    key: "home_living",
    patterns: [/home/i, /living/i, /furniture/i, /decor/i, /appliance/i, /interior/i],
  },
  {
    key: "food_dining",
    patterns: [/food/i, /dining/i, /restaurant/i, /cafe/i, /bakery/i, /catering/i, /takeaway/i],
  },
  {
    key: "trade_maintenance",
    patterns: [/trade/i, /maintenance/i, /repair/i, /plumb/i, /electric/i, /clean/i, /handyman/i],
  },
  {
    key: "professional_services",
    patterns: [/service/i, /consult/i, /legal/i, /account/i, /finance/i, /marketing/i, /\bit\b/i],
  },
  {
    key: "education_training",
    patterns: [/education/i, /training/i, /school/i, /course/i, /workshop/i, /tutor/i],
  },
  {
    key: "events_entertainment",
    patterns: [/event/i, /concert/i, /festival/i, /market/i, /show/i, /entertainment/i, /party/i],
  },
  {
    key: "automotive_transport",
    patterns: [/auto/i, /car/i, /vehicle/i, /transport/i, /logistics/i, /taxi/i, /shuttle/i],
  },
  {
    key: "tourism_hospitality",
    patterns: [
      /\btour\b/i,
      /tourism/i,
      /hotel/i,
      /lodge/i,
      /safari/i,
      /guest\s?house/i,
      /\bbnb\b/i,
      /hostel/i,
      /resort/i,
      /travel\s?agent/i,
    ],
  },
];

const EXACT_CATEGORY_MAP = new Map(
  BUSINESS_CATEGORIES.flatMap((category) => [
    [category.value, category.value],
    [category.label.toLowerCase(), category.value],
  ])
);

export function inferPromotionCategoryKey(
  category: string | null | undefined,
  promotionType?: PromotionType
): BusinessCategory {
  const normalized = category?.trim().toLowerCase();

  if (normalized) {
    const exactMatch = EXACT_CATEGORY_MAP.get(normalized);
    if (exactMatch) {
      return exactMatch;
    }

    const keywordMatch = KEYWORD_MAP.find(({ patterns }) =>
      patterns.some((pattern) => pattern.test(normalized))
    );
    if (keywordMatch) {
      return keywordMatch.key;
    }
  }

  if (promotionType === "event") {
    return "events_entertainment";
  }

  return "general_other";
}

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

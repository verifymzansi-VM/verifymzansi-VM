import {
  getPromotionFilterTypeFromStoredType,
  getPromotionFilterTypeLabel,
  type PromotionFilterType,
} from "@/lib/promotions/type-taxonomy";
import type { PromotionType } from "@/types/enums";

export interface PromotionTypePresentation {
  label: string;
  cardTagLabel: string;
  activeClassName: string;
  inactiveClassName: string;
  cardBadgeClassName: string;
  cardTagClassName: string;
  cardAccentClassName: string;
}

export const ALL_PROMOTION_TYPE_PRESENTATION: PromotionTypePresentation = {
  label: "All",
  cardTagLabel: "All",
  activeClassName:
    "border-zinc-950 bg-white text-zinc-950 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.4)] dark:border-white/80 dark:bg-white dark:text-zinc-950",
  inactiveClassName:
    "border-zinc-300 bg-zinc-50 text-zinc-900 hover:border-zinc-500 hover:bg-white dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:border-white/35 dark:hover:bg-white/10",
  cardBadgeClassName: "bg-white/95 text-zinc-950 border border-white/70",
  cardTagClassName: "bg-white text-zinc-950",
  cardAccentClassName: "hover:border-zinc-950/45",
};

export const PROMOTION_FILTER_TYPE_PRESENTATIONS: Record<
  PromotionFilterType,
  PromotionTypePresentation
> = {
  event: {
    label: getPromotionFilterTypeLabel("event"),
    cardTagLabel: "Event",
    activeClassName:
      "border-sunset-600 bg-sunset-600 text-white shadow-[0_12px_24px_-16px_rgba(228,88,28,0.72)]",
    inactiveClassName:
      "border-sunset-300 bg-sunset-50 text-sunset-700 hover:border-sunset-500 hover:bg-sunset-100 dark:border-sunset-700/70 dark:bg-sunset-950/45 dark:text-sunset-100 dark:hover:border-sunset-500 dark:hover:bg-sunset-900/60",
    cardBadgeClassName: "bg-sunset-700 text-white border border-white/10",
    cardTagClassName: "bg-sunset-700 text-white",
    cardAccentClassName: "hover:border-sunset-600/60",
  },
};

export function getPromotionFilterTypePresentation(
  value: PromotionFilterType | undefined
): PromotionTypePresentation {
  return value ? PROMOTION_FILTER_TYPE_PRESENTATIONS[value] : ALL_PROMOTION_TYPE_PRESENTATION;
}

export function getStoredPromotionTypePresentation(
  value: PromotionType
): PromotionTypePresentation {
  return PROMOTION_FILTER_TYPE_PRESENTATIONS[getPromotionFilterTypeFromStoredType(value)];
}

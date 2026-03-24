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
  deal: {
    label: getPromotionFilterTypeLabel("deal"),
    cardTagLabel: "Deal",
    activeClassName:
      "border-blue-600 bg-blue-600 text-white shadow-[0_12px_24px_-16px_rgba(37,99,235,0.72)]",
    inactiveClassName:
      "border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-500 hover:bg-blue-100 dark:border-blue-700/70 dark:bg-blue-950/45 dark:text-blue-100 dark:hover:border-blue-500 dark:hover:bg-blue-900/60",
    cardBadgeClassName: "bg-blue-700/95 text-white border border-white/10",
    cardTagClassName: "bg-blue-600 text-white",
    cardAccentClassName: "hover:border-blue-600/60",
  },
  promotion: {
    label: getPromotionFilterTypeLabel("promotion"),
    cardTagLabel: "Promo",
    activeClassName:
      "border-emerald-500 bg-emerald-500 text-white shadow-[0_12px_24px_-16px_rgba(16,185,129,0.72)]",
    inactiveClassName:
      "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-500 hover:bg-emerald-100 dark:border-emerald-700/70 dark:bg-emerald-950/45 dark:text-emerald-100 dark:hover:border-emerald-500 dark:hover:bg-emerald-900/60",
    cardBadgeClassName: "bg-emerald-700/95 text-white border border-white/10",
    cardTagClassName: "bg-emerald-500 text-white",
    cardAccentClassName: "hover:border-emerald-600/60",
  },
  ad: {
    label: getPromotionFilterTypeLabel("ad"),
    cardTagLabel: "Ads",
    activeClassName:
      "border-amber-400 bg-amber-400 text-amber-950 shadow-[0_12px_24px_-16px_rgba(251,191,36,0.72)]",
    inactiveClassName:
      "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500 hover:bg-amber-100 dark:border-amber-700/70 dark:bg-amber-950/45 dark:text-amber-100 dark:hover:border-amber-500 dark:hover:bg-amber-900/60",
    cardBadgeClassName: "bg-amber-300/95 text-amber-950 border border-white/20",
    cardTagClassName: "bg-amber-400 text-amber-950",
    cardAccentClassName: "hover:border-amber-400/70",
  },
  event: {
    label: getPromotionFilterTypeLabel("event"),
    cardTagLabel: "Event",
    activeClassName:
      "border-red-500 bg-red-500 text-white shadow-[0_12px_24px_-16px_rgba(239,68,68,0.72)]",
    inactiveClassName:
      "border-red-300 bg-red-50 text-red-700 hover:border-red-500 hover:bg-red-100 dark:border-red-700/70 dark:bg-red-950/45 dark:text-red-100 dark:hover:border-red-500 dark:hover:bg-red-900/60",
    cardBadgeClassName: "bg-red-600/95 text-white border border-white/10",
    cardTagClassName: "bg-red-500 text-white",
    cardAccentClassName: "hover:border-red-600/60",
  },
};

export const PROMOTION_FILTER_BAR_ORDER: Array<PromotionFilterType | "all"> = [
  "all",
  "deal",
  "promotion",
  "ad",
  "event",
];

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

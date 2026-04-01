import type { SideCardItem } from "./showroom-side-card";

/**
 * Branded promotional banners used as the last-resort fallback
 * when no user-uploaded photos are available for the side cards.
 */
export const BRANDED_SIDE_CARD_FALLBACKS: SideCardItem[] = [
  {
    id: "promo-list-business",
    imageUrl: "/images/fallbacks/side-card-list-business.svg",
    href: "/post/create-business",
  },
  {
    id: "promo-sell-market",
    imageUrl: "/images/fallbacks/side-card-sell-market.svg",
    href: "/post/create-listing",
  },
  {
    id: "promo-promote-event",
    imageUrl: "/images/fallbacks/side-card-promote-event.svg",
    href: "/advertise",
  },
  {
    id: "promo-trusted-marketplace",
    imageUrl: "/images/fallbacks/side-card-trusted-marketplace.svg",
    href: "/mzansi-market",
  },
];

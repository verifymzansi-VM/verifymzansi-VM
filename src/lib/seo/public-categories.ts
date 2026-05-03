export const VERIFY_MZANSI_SITE_TITLE = "VerifyMzansi";

export const VERIFY_MZANSI_SITE_DESCRIPTION =
  "VerifyMzansi helps South Africans find and post trusted local listings, business services, tourism accommodation, experiences, venues, and events.";

export const VERIFY_MZANSI_CATEGORY_SEO = [
  {
    id: "mzansi-market",
    name: "Mzansi Market",
    href: "/mzansi-market",
    title: "Mzansi Market - Local Classified Ads in South Africa",
    description:
      "Buy, sell, and browse local classified ads in South Africa. Mzansi Market covers products, vehicles, property, electronics, home goods, and everyday listings from identity-reviewed members.",
  },
  {
    id: "mzansi-business",
    name: "Mzansi Business",
    href: "/mzansi-business",
    title: "Mzansi Business - South African Business Directory",
    description:
      "Find South African businesses, shops, trades, and professional services. Mzansi Business profiles are posted by identity-reviewed representatives and can be browsed by business type and location.",
  },
  {
    id: "tourism-events",
    name: "Tourism & Events",
    href: "/tourism-events",
    title: "Tourism & Events - South African Places, Stays, Experiences, and Events",
    description:
      "Discover South African places to visit, accommodation, restaurants, tours, experiences, venues, and live events posted by identity-reviewed hosts, organisers, and local businesses.",
  },
] as const;

export type VerifyMzansiCategoryId = (typeof VERIFY_MZANSI_CATEGORY_SEO)[number]["id"];

export function getVerifyMzansiCategorySeo(id: VerifyMzansiCategoryId) {
  return VERIFY_MZANSI_CATEGORY_SEO.find((category) => category.id === id);
}

export function getRequiredVerifyMzansiCategorySeo(id: VerifyMzansiCategoryId) {
  const category = getVerifyMzansiCategorySeo(id);
  if (!category) {
    throw new Error(`Unknown VerifyMzansi category: ${id}`);
  }
  return category;
}

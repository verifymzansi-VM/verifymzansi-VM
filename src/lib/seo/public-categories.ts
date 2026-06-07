export const VERIFY_MZANSI_SITE_DESCRIPTION =
  "VerifyMzansi helps South Africans find and post trusted local listings across Mzansi Market, Mzansi Business, and Tourism and Events.";

export const VERIFY_MZANSI_CATEGORY_SEO = [
  {
    id: "mzansi-market",
    name: "Mzansi Market",
    searchName: "Mzansi Market",
    href: "/mzansi-market",
    title: "Mzansi Market - Local Classified Ads in South Africa",
    searchSummary:
      "Mzansi Market is for buying, selling, and browsing local classified ads across South Africa.",
    description:
      "Buy, sell, and browse local classified ads in South Africa. Mzansi Market covers products, vehicles, property, electronics, home goods, and everyday listings from identity-reviewed members.",
  },
  {
    id: "mzansi-business",
    name: "Mzansi Business",
    searchName: "Mzansi Business",
    href: "/mzansi-business",
    title: "Mzansi Business - South African Business Directory",
    searchSummary:
      "Mzansi Business is a directory for South African shops, trades, services, and professional profiles.",
    description:
      "Find South African businesses, shops, trades, and professional services. Mzansi Business profiles are posted by identity-reviewed representatives and can be browsed by business type and location.",
  },
  {
    id: "tourism-events",
    name: "Tourism & Events",
    searchName: "Tourism and Events",
    href: "/tourism-events",
    title: "Tourism & Events - South African Places, Stays, Experiences, and Events",
    searchSummary:
      "Tourism and Events covers South African stays, destinations, venues, experiences, and live events.",
    description:
      "Discover South African places to visit, accommodation, restaurants, tours, experiences, venues, and live events posted by identity-reviewed hosts, organisers, and local businesses.",
  },
] as const;

export type VerifyMzansiCategoryId = (typeof VERIFY_MZANSI_CATEGORY_SEO)[number]["id"];

function getVerifyMzansiCategorySeo(id: VerifyMzansiCategoryId) {
  return VERIFY_MZANSI_CATEGORY_SEO.find((category) => category.id === id);
}

export function getRequiredVerifyMzansiCategorySeo(id: VerifyMzansiCategoryId) {
  const category = getVerifyMzansiCategorySeo(id);
  if (!category) {
    throw new Error(`Unknown VerifyMzansi category: ${id}`);
  }
  return category;
}

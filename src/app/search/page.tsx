import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { SiteSearch, type SearchAreaKey } from "@/components/search/site-search";
import { normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";
import { getDataBackend } from "@/lib/data-backend";
import { FoundationSiteSearch } from "@/components/foundation/site-search";

const AREAS: readonly SearchAreaKey[] = ["listings", "businesses", "promotions", "pages"];

type SearchPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    province?: string | string[];
    city?: string | string[];
    org?: string | string[];
    area?: string | string[];
  }>;
};

function cleanQuery(value: string | string[] | undefined) {
  return (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, 100);
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const query = cleanQuery((await searchParams).q);
  return {
    // Names the search in the browser tab and history, e.g. "plumber" – Search.
    title: query ? `“${query.slice(0, 60)}” – Search` : "Search",
    description: "Search listings, businesses, tourism, events and website pages.",
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = cleanQuery(params.q);
  const province = normalizeProvinceName(
    typeof params.province === "string" ? params.province.slice(0, 60) : ""
  );
  // Cities are stored in title case (e.g. "Richards Bay").
  const typedCity = (typeof params.city === "string" ? params.city : "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .toLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toUpperCase());
  const city = (province && resolveCityName(province, typedCity)) || typedCity;
  const area = AREAS.find((key) => key === params.area);
  const org =
    typeof params.org === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(params.org) ? params.org : "";
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1">
        {getDataBackend() === "foundation" ? (
          <FoundationSiteSearch searchParams={searchParams} />
        ) : (
          <SiteSearch
            key={`${query}:${province}:${city}:${org}`}
            query={query}
            province={province ?? ""}
            city={city}
            org={org}
            area={area}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

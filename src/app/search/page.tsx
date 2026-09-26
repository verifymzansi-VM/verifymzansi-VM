import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { SiteSearch } from "@/components/search/site-search";

export const metadata: Metadata = {
  title: "Search VerifyMzansi",
  description: "Search listings, businesses, tourism, events and website pages.",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    city?: string | string[];
    org?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const query = (typeof params.q === "string" ? params.q : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  // Cities are stored in title case (e.g. "Richards Bay").
  const city = (typeof params.city === "string" ? params.city : "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .toLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toUpperCase());
  const org =
    typeof params.org === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(params.org) ? params.org : "";
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="container-page flex-1 py-8">
        <h1 className="font-display text-3xl font-bold">Search VerifyMzansi</h1>
        <p className="mt-2 text-muted-foreground">
          Find listings, businesses, tourism, events and website pages.
        </p>
        <SiteSearch key={`${query}:${city}:${org}`} query={query} city={city} org={org} />
      </main>
      <Footer />
    </div>
  );
}

import Link from "next/link";
import { matchPages } from "@/components/search/search-sources";
import { FoundationMarketplace } from "./public-marketplace";

export async function FoundationSiteSearch({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = (typeof params.q === "string" ? params.q : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const pagesOnly = params.area === "pages";
  const pages = query ? matchPages(query) : [];
  return (
    <>
      {pagesOnly ? (
        <section className="container-page space-y-5 py-8">
          <h1 className="font-display text-3xl font-bold">Search website pages</h1>
          <form method="get" className="flex gap-3">
            <input type="hidden" name="area" value="pages" />
            <label className="flex-1">
              Search
              <input
                name="q"
                defaultValue={query}
                maxLength={100}
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3"
              />
            </label>
            <button className="mt-auto h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground">
              Find pages
            </button>
          </form>
          <Link className="underline" href={`/search?${new URLSearchParams({ q: query })}`}>
            Search all posts
          </Link>
        </section>
      ) : (
        await FoundationMarketplace({ searchParams: Promise.resolve({ ...params, q: query }) })
      )}
      {query && (
        <section className="container-page space-y-4 pb-8" aria-label="Website pages">
          <h2 className="text-xl font-semibold">Website pages</h2>
          {pages.length ? (
            <ul className="grid gap-4 sm:grid-cols-2">
              {pages.map((page) => (
                <li key={page.href} className="rounded-lg border p-4">
                  <Link className="font-semibold underline" href={page.href}>
                    {page.title}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">{page.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No website pages match this search.</p>
          )}
        </section>
      )}
    </>
  );
}

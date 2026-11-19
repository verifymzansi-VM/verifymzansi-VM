/**
 * How deep public browsing and search go. Deep pages are slow to serve, so
 * page links stop at SEARCH_MAX_PAGES (owner decision, 18 November 2026:
 * 100 pages) and the database refuses a page offset above SEARCH_MAX_OFFSET
 * (internal.search_posts, database update 20261119065758_privacy_tightening_2).
 * A visitor who wants more narrows the search.
 */
export const SEARCH_MAX_PAGES = 100;
/** The deepest page offset the database serves (same value in SQL). */
export const SEARCH_MAX_OFFSET = 4800;

/** The last page served at `pageSize` results per page: at most
 * SEARCH_MAX_PAGES, and never one whose reads (in batches of up to 48 from
 * the page's first result) start past SEARCH_MAX_OFFSET. */
export function searchLastPage(pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize));
  return Math.max(1, Math.min(SEARCH_MAX_PAGES, Math.floor(SEARCH_MAX_OFFSET / size)));
}

/** Page links for `total` results: the number of pages to offer, and, when
 * the results go deeper than that, how many results those pages show. */
export function searchPagination(total: number, pageSize: number) {
  const all = Math.ceil(Math.max(0, total) / Math.max(1, pageSize));
  const last = searchLastPage(pageSize);
  return all > last
    ? { totalPages: last, limitedTo: last * pageSize }
    : { totalPages: all, limitedTo: null };
}

/** The line on the last page when results go deeper than the page links. */
export function searchDepthNotice(limitedTo: number) {
  return `Showing the first ${new Intl.NumberFormat("en-ZA").format(limitedTo)} results. Narrow your search to see more.`;
}

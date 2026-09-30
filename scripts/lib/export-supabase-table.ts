/** Supplemental REST export only: separate requests are not a database snapshot. */
export async function exportSupabaseTable(
  baseUrl: string,
  table: string,
  headers: HeadersInit,
  request: typeof fetch = fetch
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let expectedTotal: number | undefined;
  for (;;) {
    const start = rows.length;
    const response = await request(`${baseUrl}/rest/v1/${table}?select=*`, {
      headers: {
        ...Object.fromEntries(new Headers(headers)),
        Range: `${start}-${start + 999}`,
        "Range-Unit": "items",
        Prefer: "count=exact",
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Could not read ${table}: HTTP ${response.status}.`);
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new Error(`Unexpected response while reading ${table}.`);
    const range = response.headers.get("content-range")?.match(/^(?:(\d+)-(\d+)|\*)\/(\d+)$/u);
    if (!range) throw new Error(`Missing exact Content-Range while reading ${table}.`);
    const total = Number(range[3]);
    if (!Number.isSafeInteger(total) || (expectedTotal !== undefined && expectedTotal !== total)) {
      throw new Error(`Row count changed while exporting ${table}; retry with writes paused.`);
    }
    expectedTotal = total;
    if (total === 0 && start === 0 && page.length === 0) return rows;
    if (
      page.length === 0 ||
      Number(range[1]) !== start ||
      Number(range[2]) !== start + page.length - 1 ||
      start + page.length > total
    )
      throw new Error(`Inconsistent Content-Range while reading ${table}.`);
    rows.push(...page);
    if (rows.length === total) return rows;
    // Advance by the actual range, even when PostgREST caps it below our request.
  }
}

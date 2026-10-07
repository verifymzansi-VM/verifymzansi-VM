/**
 * The owner's own listing for the edit form, including the private street
 * address the public database role can't read (GET /api/listings/[id]).
 */
export async function loadOwnListing(
  id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- row shape as before (select *)
): Promise<{ data: any; error: { code: string; message: string } | null }> {
  const res = await fetch(`/api/listings/${id}`, { cache: "no-store" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  const body = (await res.json().catch(() => ({}))) as { listing?: any };
  if (res.ok) return { data: body.listing ?? null, error: null };
  if (res.status === 404) return { data: null, error: null };
  return { data: null, error: { code: String(res.status), message: "Listing request failed" } };
}

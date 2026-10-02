export interface ShowroomEntry {
  table: "businesses" | "listings" | "promotions";
  id: string;
  isLocal: boolean;
}

/**
 * Share of showroom places offered to the visitor's own province: 4 of 7 on
 * the section pages (L L N L N L N), the rest national, so posts from small
 * provinces still reach the big cities and a showroom is never empty.
 */
const LOCAL_SHARE = 0.55;

/**
 * Interleave local and national posts, keeping each side in its ranked
 * order. When either side runs out, the other fills the remaining places.
 */
export function mixLocalFirst(entries: ShowroomEntry[], province: string | null): ShowroomEntry[] {
  if (!province) return entries;
  const local = entries.filter((entry) => entry.isLocal);
  const national = entries.filter((entry) => !entry.isLocal);
  if (local.length === 0 || national.length === 0) return entries;

  const mixed: ShowroomEntry[] = [];
  let localTaken = 0;
  while (local.length > 0 || national.length > 0) {
    const preferLocal = localTaken / (mixed.length + 1) < LOCAL_SHARE;
    const next =
      (preferLocal && local.length > 0) || national.length === 0 ? local.shift() : national.shift();
    if (!next) break;
    if (next.isLocal) localTaken += 1;
    mixed.push(next);
  }
  return mixed;
}

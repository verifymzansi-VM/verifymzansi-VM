/**
 * Which paid add-ons are on sale, and for which posts (owner decision,
 * 14 October 2026).
 *
 * Boost and Featured only change anything on the events page, which lists
 * boosted events first and then featured ones. Every other list (Mzansi Market,
 * Mzansi Business, tourism businesses, the showrooms and the home page) uses the
 * fair rotation, which deliberately ignores them, so they are not sold there.
 * Urgent adds a visible label wherever the post appears, so it stays on sale.
 *
 * Both the dashboard buttons and the checkout routes use this one rule.
 */

export type AddonKind = "boost" | "featured" | "urgent";
export type AddonTarget = "listing" | "business" | "promotion";

export const ADDON_UNAVAILABLE_CODE = "addon_unavailable";

export const ADDON_UNAVAILABLE_MESSAGE =
  "Boost and Featured are only offered for events. Urgent is still available for this post.";

export function isAddonOffered(
  kind: AddonKind,
  target: AddonTarget,
  promotionType?: string | null
): boolean {
  if (kind === "urgent") return true;
  return target === "promotion" && promotionType === "event";
}

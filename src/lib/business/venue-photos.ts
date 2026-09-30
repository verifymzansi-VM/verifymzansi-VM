/**
 * Mall / market venue photos help customers find a shop. Current forms store
 * them in `category_details.venue_photos`; older mall-store profiles kept them
 * in `business_details.mall_photos`. Read both, newest location first.
 */
export function getBusinessVenuePhotoUrls(
  businessDetails: unknown,
  categoryDetails: unknown
): string[] {
  const urls: string[] = [];
  const add = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const url of value) {
      if (typeof url === "string" && url.trim() && !urls.includes(url)) urls.push(url);
    }
  };

  if (categoryDetails && typeof categoryDetails === "object") {
    add((categoryDetails as { venue_photos?: unknown }).venue_photos);
  }
  if (businessDetails && typeof businessDetails === "object") {
    const record = businessDetails as { type?: unknown; mall_photos?: unknown };
    if (record.type === "mall_store") add(record.mall_photos);
  }
  return urls;
}

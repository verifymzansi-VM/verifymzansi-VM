export interface ListingCardStatus {
  label: string;
  className: string;
}

function isNew(createdAt: string): boolean {
  return new Date().getTime() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

/** A card's status chip: "New" for a day. Paid add-ons (Urgent, Featured,
 * Boost) were removed (item 37), so a card never shows a paid label. */
export function getListingCardStatus({
  createdAt,
}: {
  createdAt?: string;
}): ListingCardStatus | null {
  if (createdAt && isNew(createdAt)) {
    return {
      label: "New",
      className: "bg-emerald-500/95 text-white border border-white/10",
    };
  }

  return null;
}

export interface ListingCardStatus {
  label: string;
  className: string;
}

function isNew(createdAt: string): boolean {
  return new Date().getTime() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

export function getListingCardStatus({
  urgent,
  createdAt,
}: {
  featured?: boolean;
  boosted?: boolean;
  urgent?: boolean;
  createdAt?: string;
}): ListingCardStatus | null {
  if (urgent) {
    return {
      label: "Urgent",
      className: "bg-red-500/95 text-white border border-white/10",
    };
  }

  if (createdAt && isNew(createdAt)) {
    return {
      label: "New",
      className: "bg-emerald-500/95 text-white border border-white/10",
    };
  }

  return null;
}

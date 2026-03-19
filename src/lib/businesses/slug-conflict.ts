type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  constraint?: string | null;
};

export const BUSINESS_SLUG_CONFLICT_RESPONSE = {
  error: "Business slug already in use",
  reason: "Choose a different URL slug for this business.",
  details: { slug: "This URL slug is already taken." },
} as const;

export function isBusinessSlugConflictError(error: DatabaseErrorLike | null | undefined): boolean {
  if (error?.code !== "23505") {
    return false;
  }

  const haystack = [error.constraint, error.message, error.details]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  return haystack.includes("slug") && haystack.includes("business");
}

"use client";

import { scoreListingQuality, type QualityInput } from "@/lib/quality/score-listing";

/**
 * Advisory quality check shown before submitting. It never blocks posting;
 * it explains how to make the listing clearer and more trustworthy.
 */
export function ListingQualityHint(input: QualityInput) {
  const { score, issues } = scoreListingQuality(input);
  const tone =
    score >= 80
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
      : score >= 50
        ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
        : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30";

  return (
    <section
      aria-label="Listing quality"
      className={`rounded-lg border p-3 text-sm ${tone}`}
      data-testid="listing-quality-hint"
    >
      <p className="font-medium">Listing quality {score} / 100</p>
      {issues.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {issues.map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs">Looks complete. Moderators still review every post.</p>
      )}
    </section>
  );
}

"use client";

import { CheckCircle2, CircleAlert, Sparkles } from "lucide-react";
import { scoreListingQuality, type QualityInput } from "@/lib/quality/score-listing";
import { cn } from "@/lib/utils";

/**
 * Advisory quality check shown before submitting. It never blocks posting;
 * it explains how to make the listing clearer and more trustworthy.
 */
export function ListingQualityHint(input: QualityInput) {
  const { score, issues } = scoreListingQuality(input);
  const level = score >= 80 ? "strong" : score >= 50 ? "fair" : "weak";
  const tone = {
    strong: {
      panel:
        "border-brand-green-200 bg-brand-green-50/70 dark:border-brand-green-800/70 dark:bg-brand-green-950/30",
      bar: "bg-brand-green-600 dark:bg-brand-green-400",
      icon: "text-brand-green-700 dark:text-brand-green-300",
      label: "Looking good",
    },
    fair: {
      panel:
        "border-brand-gold-200 bg-brand-gold-50/70 dark:border-brand-gold-800/60 dark:bg-brand-gold-950/25",
      bar: "bg-brand-gold-500 dark:bg-brand-gold-400",
      icon: "text-brand-gold-800 dark:text-brand-gold-300",
      label: "Nearly there",
    },
    weak: {
      panel:
        "border-brand-red-200 bg-brand-red-50/70 dark:border-brand-red-900/70 dark:bg-brand-red-950/25",
      bar: "bg-brand-red-600 dark:bg-brand-red-400",
      icon: "text-brand-red-700 dark:text-brand-red-300",
      label: "Needs a bit more",
    },
  }[level];
  const Icon = level === "strong" ? CheckCircle2 : level === "fair" ? Sparkles : CircleAlert;

  return (
    <section
      aria-label="Listing quality"
      className={cn("rounded-2xl border p-4 text-sm", tone.panel)}
      data-testid="listing-quality-hint"
    >
      <div className="flex items-center gap-3">
        <Icon className={cn("h-5 w-5 shrink-0", tone.icon)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold text-foreground">Listing quality {score} / 100</p>
            <span className="text-xs font-medium text-muted-foreground">{tone.label}</span>
          </div>
          <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card">
            <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${score}%` }} />
          </div>
        </div>
      </div>
      {issues.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-[13px] leading-5 text-foreground/85">
          {issues.map((issue) => (
            <li key={issue.code} className="flex gap-2">
              <span
                aria-hidden="true"
                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
              />
              {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Looks complete. Moderators still review every post.
        </p>
      )}
    </section>
  );
}

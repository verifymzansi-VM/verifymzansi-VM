"use client";

import { ScanFace, UserCheck } from "lucide-react";
import {
  IDENTITY_CHECK_REASON_LABELS,
  IDENTITY_CHECK_STATUS_LABELS,
  formatSastDateTime,
  type IdentityCheckForCase,
} from "@/lib/admin/identity-check-settings";
import { cn } from "@/lib/utils";

export type CaseIdentityCheck = IdentityCheckForCase & { typedNames: string };

const STATUS_TONE: Partial<Record<IdentityCheckForCase["status"], string>> = {
  approved:
    "border-brand-green-600/30 bg-brand-green-50 text-brand-green-800 dark:bg-brand-green-500/10 dark:text-brand-gold-200",
  with_staff:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  declined:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
};

/**
 * The case's latest Didit check in the review case view (Didit plan, section
 * 6): its result, why it did not pass, the names the member typed, and the
 * member's "ask a person to look again" note. Staff screens may name Didit.
 */
export function IdentityCheckPanel({ check }: { check: CaseIdentityCheck }) {
  return (
    <section
      aria-labelledby="case-identity-check-title"
      className="space-y-2 rounded-lg border p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="case-identity-check-title" className="flex items-center gap-1.5 font-semibold">
          <ScanFace className="h-4 w-4" aria-hidden="true" />
          Didit check
        </h3>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            STATUS_TONE[check.status] ?? "border-border bg-muted text-foreground"
          )}
        >
          {IDENTITY_CHECK_STATUS_LABELS[check.status]}
        </span>
        <span className="text-xs text-muted-foreground">
          Started {formatSastDateTime(check.createdAt)}
          {check.finishedAt ? ` · result ${formatSastDateTime(check.finishedAt)}` : ""}
        </span>
      </div>
      <p>
        <span className="text-muted-foreground">Names typed: </span>
        <span className="font-medium">{check.typedNames}</span>
      </p>
      {check.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Why it did not pass">
          {check.reasons.map((reason) => (
            <li
              key={reason}
              title={reason}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {IDENTITY_CHECK_REASON_LABELS[reason] ?? reason.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      )}
      {check.askedAt && (
        <div className="space-y-1 rounded-lg bg-muted/60 p-2.5">
          <p className="flex items-center gap-1.5 font-semibold">
            <UserCheck className="h-4 w-4" aria-hidden="true" />
            Asked a person to look again · {formatSastDateTime(check.askedAt)}
          </p>
          {check.askReason && (
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {check.askReason}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

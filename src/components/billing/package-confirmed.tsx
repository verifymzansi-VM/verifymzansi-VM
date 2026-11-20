import Link from "next/link";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { formatDateTime, formatSaLongDate } from "@/lib/utils/format";
import type { PackageConfirmation } from "@/lib/payments/package-confirmation";

/**
 * The payment confirmation for a Multi-listing package (roadmap P4a): what
 * the member now holds, in South African time, and where to go next; for
 * slots added part-way (P4b) how many were added and the new total, which all
 * end together. The general "Payment confirmed" card stays for every other
 * payment.
 */
export function PackageConfirmed({ details }: { details: PackageConfirmation }) {
  const added = details.addedSlots ?? null;
  const rows: Array<[string, string]> = [
    ...(added === null
      ? ([["Slots", details.slots.toLocaleString("en-ZA")]] as Array<[string, string]>)
      : ([
          ["Slots added", added.toLocaleString("en-ZA")],
          ["Slots in total", details.slots.toLocaleString("en-ZA")],
        ] as Array<[string, string]>)),
    ...(added === null
      ? ([["Started", `${formatDateTime(details.startsAt)} (SA time)`]] as Array<[string, string]>)
      : []),
    [added === null ? "Ends" : "All end", `${formatDateTime(details.endsAt)} (SA time)`],
    ["New posts", `Up to ${details.newPostsLimit.toLocaleString("en-ZA")} every 30 days`],
    ["Paid", `${formatPlanPrice(details.paidCents)} online`],
  ];
  return (
    <div className="container-page max-w-lg">
      <div className="rounded-3xl border border-border/70 bg-card p-6 elev-md sm:p-8">
        <div aria-live="polite" className="text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-gold-300">
            <Check aria-hidden="true" className="h-8 w-8" strokeWidth={3} />
          </span>
          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground">
            {added === null ? "Your package is active" : "Slots added"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {added === null
              ? `Payment confirmed. Your ${details.slots.toLocaleString("en-ZA")} slots are ready to use now.`
              : `Payment confirmed. ${added.toLocaleString("en-ZA")} ${added === 1 ? "slot" : "slots"} added, ${details.slots.toLocaleString("en-ZA")} in total, all ending ${formatSaLongDate(details.endsAt)}.`}
          </p>
        </div>

        <dl className="mt-6 divide-y divide-border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-muted/60 p-4 text-sm leading-6 text-foreground/85">
          <Info aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
          {/* Draft n1's reminder sentence comes back with package reminders (P4d). */}
          Nothing renews automatically.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Button asChild variant="trust-verified" className="h-11 rounded-full px-6">
            <Link href="/post/create">Create a post</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-full px-6">
            <Link href="/dashboard/slots">Go to My slots</Link>
          </Button>
        </div>

        {details.individualSlots ? (
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            Posts in your Individual slots can move into the package when those slots end, while it
            has free places.
          </p>
        ) : null}
      </div>
    </div>
  );
}

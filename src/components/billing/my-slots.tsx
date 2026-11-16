import Link from "next/link";
import { BadgeCheck, Building2, Gift, Layers, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSaLongDate, saCalendarDaysBetween } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { FoundationMySlots } from "@/lib/foundation/billing-runtime";

type Slot = FoundationMySlots["slots"][number];
type SlotPost = Slot["posts"][number];

const SOURCE: Record<Slot["source"], { label: string; icon: typeof Layers }> = {
  retail_paid: { label: "Paid slot", icon: Layers },
  intro_trial: { label: "Free first post", icon: Gift },
  staff_grant: { label: "Slot from VerifyMzansi", icon: BadgeCheck },
  contract: { label: "Contract slot", icon: BadgeCheck },
  sponsorship: { label: "Sponsored place", icon: Building2 },
};

function slotName(slot: Slot) {
  if (slot.individual) return "Individual slot";
  if (slot.source === "sponsorship" && slot.sponsor) return `Paid by ${slot.sponsor}`;
  return SOURCE[slot.source].label;
}

/** The post's own page to manage it from (the edit flow for its kind). */
function postHref(post: SlotPost) {
  return post.kind === "business"
    ? `/post/edit-business/${post.id}`
    : `/post/edit-listing/${post.id}`;
}

function daysLeft(endsAt: string, now: Date) {
  const days = saCalendarDaysBetween(now, endsAt);
  return days <= 0 ? "Ends today" : days === 1 ? "1 day left" : `${days} days left`;
}

/**
 * "My slots" (Pricing v2 P2, renewing P3): every slot the member holds and
 * every slot that ended in the last 3 days, phone first. Each shows the post in
 * it (or that it is empty), its end date and days left, or, once ended, until
 * when its post is kept. An Individual slot can be renewed from 14 days before
 * it ends ("Renew", and "Renew all" when several can): the new days start when
 * its current days end, and a renewed slot shows until when it is renewed. One
 * "Buy a slot" buys a new slot with its own end date.
 */
export function MySlots({
  slots,
  individual,
  buyHref,
  now = new Date(),
}: {
  slots: FoundationMySlots["slots"];
  individual: FoundationMySlots["individual"];
  /** The checkout for a 30-day Individual slot; null when none is on sale. */
  buyHref: string | null;
  now?: Date;
}) {
  const room = individual.limit - individual.held - individual.pending;
  const renewable = individual.verified
    ? slots.filter((slot) => slot.individual && slot.renewable)
    : [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3.5">
        <p className="text-sm text-muted-foreground">
          <span className="font-display text-2xl font-bold text-foreground">{individual.held}</span>{" "}
          of {individual.limit} Individual slots
          {individual.limit_ends_at ? ` until ${formatSaLongDate(individual.limit_ends_at)}` : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {renewable.length > 1 ? (
            <Button asChild variant="outline" className="h-11 rounded-full">
              <Link href="/billing/checkout?renew=all">
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Renew all
              </Link>
            </Button>
          ) : null}
          {!individual.verified ? (
            <Button asChild variant="outline" className="h-11 rounded-full">
              <Link href="/verification">Finish my ID review</Link>
            </Button>
          ) : buyHref && room > 0 ? (
            <Button asChild variant="trust-verified" className="h-11 rounded-full">
              <Link href={buyHref}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                Buy a slot
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {slots.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          No slots yet. Your first post is free for 7 days once your ID review is accepted.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Your slots">
          {slots.map((slot) => {
            const Icon = SOURCE[slot.source].icon;
            const ended = slot.state === "ended";
            const upcoming = slot.state === "upcoming";
            const empty = Math.max(0, slot.places - slot.posts.length);
            const canRenew = individual.verified && slot.individual && slot.renewable;
            const opensLater =
              individual.verified &&
              slot.individual &&
              !slot.renewable &&
              slot.renew_opens_at !== null &&
              Date.parse(slot.renew_opens_at) > now.getTime();
            return (
              <li
                key={slot.id}
                data-testid="my-slot"
                className={cn(
                  "rounded-2xl border bg-card p-4",
                  ended ? "border-dashed border-border" : "border-border/70 elev-xs"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="icon-tile area-market-tile shrink-0">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{slotName(slot)}</p>
                      <p className="text-xs text-muted-foreground">
                        {ended
                          ? formatSaLongDate(slot.ends_at)
                          : upcoming
                            ? `Starts ${formatSaLongDate(slot.starts_at)}`
                            : `Ends ${formatSaLongDate(slot.ends_at)}`}
                      </p>
                      {slot.renewed_until ? (
                        <p className="text-xs font-medium text-brand-green-700 dark:text-brand-gold-300">
                          {`Renewed until ${formatSaLongDate(slot.renewed_until)}`}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                      ended || upcoming
                        ? "bg-muted text-muted-foreground"
                        : "bg-brand-green/10 text-brand-green-700 dark:text-brand-gold-300"
                    )}
                  >
                    {ended ? "Ended" : upcoming ? "Not started" : daysLeft(slot.ends_at, now)}
                  </span>
                </div>
                <ul className="mt-3 space-y-2 border-t border-border/60 pt-3 text-sm">
                  {slot.posts.map((post) => (
                    <li key={post.id} className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={postHref(post)}
                        className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {post.title ?? "Untitled post"}
                      </Link>
                      {ended && post.deletes_at ? (
                        <span className="text-xs text-muted-foreground">
                          {`Hidden; kept until ${formatSaLongDate(post.deletes_at)}`}
                        </span>
                      ) : null}
                    </li>
                  ))}
                  {!ended && !upcoming && empty > 0 ? (
                    <li className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span>{empty === 1 ? "Empty" : `${empty} places empty`}</span>
                      <Link
                        href="/post/create"
                        className="inline-flex min-h-11 items-center font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
                      >
                        Create a post
                      </Link>
                    </li>
                  ) : null}
                </ul>
                {canRenew ? (
                  <Button asChild variant="outline" className="mt-3 h-11 w-full rounded-full">
                    <Link href={`/billing/checkout?renew=${slot.id}`}>
                      <RefreshCw aria-hidden="true" className="h-4 w-4" />
                      Renew
                    </Link>
                  </Button>
                ) : opensLater && slot.renew_opens_at ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {`You can renew from ${formatSaLongDate(slot.renew_opens_at)}.`}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

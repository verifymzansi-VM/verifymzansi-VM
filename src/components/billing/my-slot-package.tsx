import Link from "next/link";
import { ArrowRightLeft, Plus } from "lucide-react";
import { BrandSurface, brandOutlineButtonClassName } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSaLongDate, saCalendarDaysBetween } from "@/lib/utils/format";
import { PACKAGE_ADD_MIN_DAYS } from "@/lib/billing/slot-packages";
import type { FoundationMySlotPackage } from "@/lib/foundation/billing-runtime";

type SlotPackage = NonNullable<FoundationMySlotPackage["package"]>;
type PackagePost = SlotPackage["posts"][number];

/** The post's own page to manage it from (the edit flow for its kind). */
function postHref(post: PackagePost) {
  // As My posts: businesses (tourism stays included) and events have their own forms.
  return post.kind === "business"
    ? `/post/edit-business/${post.id}`
    : post.kind === "event"
      ? `/post/edit-tourism/${post.id}`
      : `/post/edit-listing/${post.id}`;
}

function daysLeftLabel(endsAt: string, now: Date) {
  const days = saCalendarDaysBetween(now, endsAt);
  return days <= 0 ? "ends today" : days === 1 ? "1 day left" : `${days} days left`;
}

/** Whole 24-hour periods left before the package ends (as the database counts
 * them when slots are added). */
function wholeDaysLeft(endsAt: string, now: Date) {
  return Math.floor((Date.parse(endsAt) - now.getTime()) / 86_400_000);
}

/**
 * The member's Multi-listing package on "My slots" (roadmap P4a; the owner's
 * approved draft p4-07): one card with the slots in use, the shared end date
 * and the days left, then the posts in the package (a post from an ended
 * Individual slot that the package took is shown as moving in) and its empty
 * places. "Add slots" (P4b) while packages are on sale and 7 or more whole
 * days are left; Renew and Team come with the later parts (P4c-P4d).
 */
export function MySlotPackage({
  slotPackage,
  now = new Date(),
  onSale = false,
}: {
  slotPackage: SlotPackage;
  now?: Date;
  /** Packages are on sale (the owner's switch): only then can slots be added. */
  onSale?: boolean;
}) {
  const ended = slotPackage.state === "ended";
  const canAdd =
    onSale && !ended && wholeDaysLeft(slotPackage.ends_at, now) >= PACKAGE_ADD_MIN_DAYS;
  const used = Math.min(slotPackage.posts.length, slotPackage.places);
  const empty = ended ? 0 : Math.max(0, slotPackage.places - slotPackage.posts.length);
  const share = slotPackage.places > 0 ? Math.round((used / slotPackage.places) * 100) : 0;
  return (
    <section aria-labelledby="slot-package-title" className="space-y-4">
      <BrandSurface as="div" className="rounded-3xl px-5 pb-7 pt-5 sm:px-6">
        <p id="slot-package-title" className="text-sm font-semibold text-white/80">
          Multi-listing package
        </p>
        <p className="mt-1 font-display text-2xl font-bold text-white">
          {ended ? (
            "Ended"
          ) : (
            <>
              <span className="text-4xl font-extrabold">{used}</span>
              {` of ${slotPackage.places} slots in use`}
            </>
          )}
        </p>
        <p
          data-testid="slot-package-ends"
          className="mt-3 inline-flex rounded-full border border-brand-gold-300/40 bg-brand-gold-300/10 px-3 py-1 text-xs font-semibold text-brand-gold-300"
        >
          {ended
            ? `Ended ${formatSaLongDate(slotPackage.ends_at)}`
            : `Ends ${formatSaLongDate(slotPackage.ends_at)} · ${daysLeftLabel(slotPackage.ends_at, now)}`}
        </p>
        {!ended ? (
          <div
            role="progressbar"
            aria-label="Slots in use"
            aria-valuemin={0}
            aria-valuemax={slotPackage.places}
            aria-valuenow={used}
            className="mt-4 h-2 overflow-hidden rounded-full bg-white/15"
          >
            <div className="h-full rounded-full bg-brand-gold-300" style={{ width: `${share}%` }} />
          </div>
        ) : null}
        {!ended ? (
          <p className="mt-3 text-xs text-white/70">
            {`${slotPackage.new_posts_started} of ${slotPackage.new_posts_limit} new posts used in the last 30 days`}
          </p>
        ) : null}
        {canAdd ? (
          <Button
            asChild
            variant="outline"
            className={cn("mt-4 h-11 rounded-full", brandOutlineButtonClassName)}
          >
            <Link href="/billing/package/add" data-testid="slot-package-add">
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add slots
            </Link>
          </Button>
        ) : null}
      </BrandSurface>

      <div>
        <h2 className="font-display text-lg font-bold text-foreground">In your package</h2>
        <ul className="mt-3 space-y-2" aria-label="Posts in your package">
          {slotPackage.posts.map((post) => (
            <li
              key={post.id}
              data-testid="package-post"
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm elev-xs"
            >
              <Link
                href={postHref(post)}
                className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
              >
                {post.title ?? "Untitled post"}
              </Link>
              {post.moving ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-green-700 dark:text-brand-gold-300">
                  <ArrowRightLeft aria-hidden="true" className="h-3.5 w-3.5" />
                  Moved in from an Individual slot
                </span>
              ) : ended && post.deletes_at ? (
                <span className="text-xs text-muted-foreground">
                  {`Hidden; kept until ${formatSaLongDate(post.deletes_at)}`}
                </span>
              ) : null}
            </li>
          ))}
          {empty > 0 ? (
            <li className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
              <Plus
                aria-hidden="true"
                className="h-5 w-5 text-brand-green-700 dark:text-brand-gold-300"
              />
              <span className="font-medium text-foreground">{`${empty} empty`}</span>
              <Link
                href="/post/create"
                className="inline-flex min-h-11 items-center font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
              >
                Create a post
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}

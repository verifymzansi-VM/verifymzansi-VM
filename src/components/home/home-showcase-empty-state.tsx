import Link from "next/link";
import { useId } from "react";
import { ArrowRight, Building2, ShoppingBag, TreePalm, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyStateTone = "green" | "blue" | "teal";

/** The same area icon and colour as the area's rail (`HomeShowcaseShell`). */
const toneStyles: Record<
  EmptyStateTone,
  { icon: LucideIcon; iconClassName: string; accentClassName: string }
> = {
  green: {
    icon: ShoppingBag,
    iconClassName:
      "bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-gold-300",
    accentClassName: "text-brand-green-700 dark:text-brand-gold-300",
  },
  blue: {
    icon: Building2,
    iconClassName:
      "bg-brand-blue/10 text-brand-blue-700 dark:bg-brand-blue/15 dark:text-brand-blue-300",
    accentClassName: "text-brand-blue-700 dark:text-brand-blue-300",
  },
  teal: {
    icon: TreePalm,
    iconClassName: "bg-teal-500/10 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
    accentClassName: "text-teal-700 dark:text-teal-300",
  },
};

interface HomeShowcaseEmptyStateProps {
  /** One line inviting the first post, e.g. "Be the first to sell on Mzansi Market". */
  title: string;
  /** Where posting in this area starts. */
  href: string;
  tone: EmptyStateTone;
}

/**
 * An area with no posts yet: instead of an empty rail, one slim "be the first"
 * card in the area's colour. The whole card is the link to post in that area.
 */
export function HomeShowcaseEmptyState({ title, href, tone }: HomeShowcaseEmptyStateProps) {
  const { icon: Icon, iconClassName, accentClassName } = toneStyles[tone];
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="py-3 sm:py-4">
      <div className="container-page">
        <Link
          href={href}
          prefetch={false}
          className="group flex min-h-16 items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-4 sm:p-4"
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12",
              iconClassName
            )}
          >
            <Icon className="h-5 w-5 sm:h-[22px] sm:w-[22px]" strokeWidth={1.75} />
          </span>
          <h2
            id={headingId}
            className="min-w-0 flex-1 font-display text-base font-bold leading-snug text-foreground sm:text-lg"
          >
            {title}
          </h2>
          <ArrowRight
            aria-hidden="true"
            className={cn(
              "h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none",
              accentClassName
            )}
          />
        </Link>
      </div>
    </section>
  );
}

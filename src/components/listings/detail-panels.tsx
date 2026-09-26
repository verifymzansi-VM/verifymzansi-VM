import type { ReactNode } from "react";
import Link from "next/link";
import { BrandShield } from "@/components/shared/brand-shield";
import { TrustBadge } from "@/components/trust/trust-badge";
import { VerifiedTick } from "@/components/trust/verified-tick";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@/types/enums";

/**
 * Shared building blocks for the three public detail pages (Mzansi Market
 * listing, Mzansi Business profile, Tourism & Events post) so trust, safety
 * and fact presentation stay identical across areas.
 */

export type DetailArea = "market" | "business" | "tourism";

const AREA_AVATAR: Record<DetailArea, string> = {
  market: "bg-brand-green-600 text-white",
  business: "bg-brand-blue-600 text-white",
  tourism: "bg-sunset-600 text-white",
};

const AREA_ICON_TILE: Record<DetailArea, string> = {
  market: "area-market-tile",
  business: "area-business-tile",
  tourism: "area-tourism-tile",
};

/** One-line care note for posters who have not finished ID review. */
const EXTRA_CARE_COPY: Record<DetailArea, string> = {
  market: "Not ID reviewed yet. Don’t pay before you see the item.",
  business: "Not ID reviewed yet. Avoid big upfront deposits.",
  tourism: "Not ID reviewed yet. Confirm bookings before you pay.",
};

/* ── Section card ───────────────────────────────────────────── */

export function DetailSection({
  title,
  icon,
  action,
  children,
  className,
  headingLevel = "h2",
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  return (
    <section className={cn("surface-card elev-xs rounded-2xl p-5 sm:p-6", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Heading className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
          {icon}
          {title}
        </Heading>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ── Fact grid ──────────────────────────────────────────────── */

export interface DetailFact {
  label: string;
  value: ReactNode;
  /** Span both columns (long text such as nearby attractions). */
  wide?: boolean;
}

export function FactGrid({ facts, className }: { facts: DetailFact[]; className?: string }) {
  if (facts.length === 0) return null;
  return (
    <dl className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3", className)}>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className={cn(
            "min-w-0 rounded-xl border border-border/70 bg-muted/40 px-3.5 py-3",
            fact.wide && "col-span-2 sm:col-span-3"
          )}
        >
          <dt className="text-xs font-medium text-muted-foreground">{fact.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Poster / representative / host trust card ──────────────── */

export function PosterTrustCard({
  area,
  roleLabel,
  name,
  trustLevel,
  location,
  avatar,
  children,
  className,
}: {
  area: DetailArea;
  /** "Sold by", "Represented by", "Hosted by"… */
  roleLabel: string;
  name: string | null | undefined;
  /** `null` when the poster's verification is unknown (e.g. private preview). */
  trustLevel: TrustLevel | null;
  location?: string | null;
  /** Optional brand logo shown in place of the initial. */
  avatar?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const displayName = name?.trim() || "Account name unavailable";
  const initial = name?.trim()?.charAt(0)?.toUpperCase() || "?";
  const isReviewed = trustLevel != null && trustLevel >= 3;

  return (
    <section className={cn("surface-card elev-sm space-y-4 rounded-2xl p-5", className)}>
      <h2 className="text-sm font-semibold text-muted-foreground">{roleLabel}</h2>

      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          {avatar ? (
            <div className="h-12 w-12 overflow-hidden rounded-full border border-border bg-white p-1 dark:bg-warm-900">
              {avatar}
            </div>
          ) : (
            <div
              aria-hidden="true"
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full font-display text-lg font-bold",
                AREA_AVATAR[area]
              )}
            >
              {initial}
            </div>
          )}
          {isReviewed ? (
            <VerifiedTick
              decorative
              pro={trustLevel === 4}
              className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-card p-px"
            />
          ) : null}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 break-words font-semibold leading-tight text-foreground">
            {displayName}
            {isReviewed ? <VerifiedTick pro={trustLevel === 4} className="h-4 w-4" /> : null}
          </p>
          {trustLevel != null ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TrustBadge level={trustLevel} size="sm" />
              {isReviewed ? (
                <Link
                  href="/trust-safety"
                  prefetch={false}
                  className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  What this means
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {trustLevel != null && !isReviewed ? (
        <p className="rounded-xl bg-brand-gold-50 px-3 py-2 text-xs font-medium text-brand-gold-900 dark:bg-brand-gold/10 dark:text-brand-gold-200">
          {EXTRA_CARE_COPY[area]}
        </p>
      ) : null}

      {location ? <p className="text-sm text-muted-foreground">{location}</p> : null}

      {children ? <div className="border-t border-border/70 pt-4">{children}</div> : null}
    </section>
  );
}

/* ── Safety tip ─────────────────────────────────────────────── */

const SAFETY_COPY: Record<DetailArea, string> = {
  market: "Meet in public and check the item before you pay.",
  business: "Get quotes in writing and never share OTPs.",
  tourism: "Confirm bookings in writing and never share OTPs.",
};

export function SafetyTipsCard({ area, className }: { area: DetailArea; className?: string }) {
  return (
    <aside
      aria-label="Safety tip"
      className={cn("surface-card flex items-start gap-3 rounded-2xl p-4", className)}
    >
      <span className={cn("icon-tile h-9 w-9", AREA_ICON_TILE[area])}>
        <BrandShield className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <p className="text-sm leading-6 text-muted-foreground">
        {SAFETY_COPY[area]}{" "}
        <Link href="/safety/meeting-checklist" prefetch={false} className="link-arrow">
          Safety tips
        </Link>
      </p>
    </aside>
  );
}

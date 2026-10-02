import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import { BRAND_SHIELD_SRC, BrandSurface, VerificationEmblem } from "@/components/brand";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { cn } from "@/lib/utils";

type InfoHeroTone = "green" | "gold" | "neutral";

interface InfoHeroProps {
  title: string;
  /** Optional closing words of the headline, painted gold. */
  accent?: string;
  description?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  kicker?: string;
  kickerIcon?: ComponentType<{ className?: string }>;
  /**
   * Call-to-action buttons under the description. Secondary buttons need
   * `brandOutlineButtonClassName` to read on the dark surface.
   */
  actions?: ReactNode;
  /** Visual beside the copy from `lg` up. Defaults to the verification emblem. */
  aside?: ReactNode;
  /** green: emblem + green glow. gold: warning pages. neutral: legal pages (no emblem). */
  tone?: InfoHeroTone;
  className?: string;
}

/**
 * Deep-green brand band for help, safety and legal pages: breadcrumbs → kicker
 * → display h1 (optional gold accent) → lede → actions, with the shield emblem
 * on the right from `lg` up and the flag stripe along the bottom.
 */
export function InfoHero({
  title,
  accent,
  description,
  breadcrumbs,
  kicker,
  kickerIcon: KickerIcon,
  actions,
  aside,
  tone = "green",
  className,
}: InfoHeroProps) {
  const visual = aside ?? (tone === "neutral" ? <LegalShield /> : <VerificationEmblem size="md" />);

  return (
    <BrandSurface as="section" glow={tone === "gold" ? "gold" : "green"} className={className}>
      <div className="container-page relative pb-9 pt-6 sm:pb-12 sm:pt-8">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} tone="inverse" />}
        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            {kicker && (
              <p className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-brand-gold-300">
                {KickerIcon && <KickerIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                {kicker}
              </p>
            )}
            <h1
              className={cn(
                "max-w-3xl font-display text-[1.875rem] font-bold leading-[1.08] tracking-[-0.03em] text-white sm:text-[2.75rem]",
                kicker && "mt-3"
              )}
            >
              {title}
              {accent && (
                <>
                  {" "}
                  <span className="gold-shine text-brand-gold-300">{accent}</span>
                </>
              )}
            </h1>
            {description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base sm:leading-7">
                {description}
              </p>
            )}
            {actions && <div className="mt-6 flex flex-wrap gap-2.5">{actions}</div>}
          </div>
          <div className="hidden lg:block">{visual}</div>
        </div>
      </div>
    </BrandSurface>
  );
}

/** Quiet shield for legal pages, where the seller-check emblem would be noise. */
function LegalShield() {
  return (
    <div aria-hidden="true" className="relative mr-6 h-40 w-40">
      <div className="absolute inset-4 rounded-full bg-brand-gold-400/15 blur-2xl" />
      <div className="absolute inset-0 rounded-full border border-white/10" />
      <Image
        src={BRAND_SHIELD_SRC}
        alt=""
        width={112}
        height={112}
        sizes="112px"
        className="absolute inset-6 h-28 w-28 object-contain opacity-90 drop-shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
      />
    </div>
  );
}

interface SectionHeadingProps {
  id: string;
  title: string;
  lede?: ReactNode;
  kicker?: string;
  className?: string;
}

/** `.section-title` + `.section-lede` pair with an id for `aria-labelledby`. */
export function SectionHeading({ id, title, lede, kicker, className }: SectionHeadingProps) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {kicker && (
        <p className="text-sm font-semibold text-brand-green-700 dark:text-brand-green-300">
          {kicker}
        </p>
      )}
      <h2 id={id} className={cn("section-title", kicker && "mt-1.5")}>
        {title}
      </h2>
      {lede && <p className="section-lede">{lede}</p>}
    </div>
  );
}

import Image from "next/image";
import { cn } from "@/lib/utils";

// Local assets bypass resizing in our loader; use the small shield for this compact mark.
export const BRAND_SHIELD_SRC = "/images/brand-shield-small.png?v=20260924";

type BrandMarkSize = "sm" | "md" | "lg";

const SIZES: Record<
  BrandMarkSize,
  { gap: string; shield: string; px: number; kicker: string; word: string }
> = {
  sm: {
    gap: "gap-2",
    shield: "h-8 w-8 lg:h-11 lg:w-11",
    px: 44,
    kicker: "text-[8px] tracking-[0.2em]",
    word: "text-[1.1rem]",
  },
  md: {
    gap: "gap-2.5",
    shield: "h-9 w-9 sm:h-10 sm:w-10 lg:h-14 lg:w-14",
    px: 56,
    kicker: "text-[9px] tracking-[0.22em]",
    word: "text-[1.3rem] sm:text-[1.45rem]",
  },
  lg: {
    gap: "gap-3",
    shield: "h-12 w-12 sm:h-14 sm:w-14 lg:h-[4.5rem] lg:w-[4.5rem]",
    px: 72,
    kicker: "text-[10px] tracking-[0.24em]",
    word: "text-[1.6rem] sm:text-[1.9rem]",
  },
};

interface BrandMarkProps {
  size?: BrandMarkSize;
  /** Light text for dark-green surfaces. Default follows the light/dark theme. */
  inverse?: boolean;
  /** Hide the "Trusted marketplace" line (tight headers). */
  hideKicker?: boolean;
  priority?: boolean;
  /** No accessible name, when a wrapping link already names it. */
  decorative?: boolean;
  className?: string;
  shieldClassName?: string;
}

/**
 * Shield + live-text wordmark. Text is real HTML so it stays sharp at every
 * size; the old raster logo washed out its tagline and "Verify" at header size.
 */
export function BrandMark({
  size = "md",
  inverse = false,
  hideKicker = false,
  priority = false,
  decorative = false,
  className,
  shieldClassName,
}: BrandMarkProps) {
  const s = SIZES[size];
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "VerifyMzansi logo"}
      aria-hidden={decorative || undefined}
      className={cn("inline-flex shrink-0 items-center", s.gap, className)}
    >
      <Image
        src={BRAND_SHIELD_SRC}
        alt=""
        width={s.px}
        height={s.px}
        sizes={`${s.px}px`}
        priority={priority}
        className={cn(
          "shrink-0 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.25)]",
          s.shield,
          shieldClassName
        )}
      />
      <span aria-hidden="true" className="flex flex-col leading-none">
        {!hideKicker && (
          <span
            className={cn(
              "font-semibold uppercase",
              s.kicker,
              inverse ? "text-white/70" : "text-muted-foreground"
            )}
          >
            Trusted marketplace
          </span>
        )}
        <span
          className={cn(
            "whitespace-nowrap font-display font-bold tracking-[-0.02em]",
            s.word,
            !hideKicker && "mt-1"
          )}
        >
          <span className={inverse ? "text-white" : "text-foreground"}>Verify</span>{" "}
          <span
            className={
              inverse ? "text-brand-green-300" : "text-brand-green-700 dark:text-brand-green-300"
            }
          >
            Mzansi
          </span>
        </span>
      </span>
    </span>
  );
}

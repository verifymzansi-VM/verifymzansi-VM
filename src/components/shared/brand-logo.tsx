import { useId } from "react";
import { cn } from "@/lib/utils";

type BrandLogoSize = "sm" | "md" | "lg" | "xl";
type BrandLogoLayout = "horizontal" | "stacked";
type BrandLogoTone = "default" | "inverse";
type BrandLogoVariant = "solid" | "transparent";

interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
  size?: BrandLogoSize;
  layout?: BrandLogoLayout;
  tone?: BrandLogoTone;
  /** Kept for API compatibility with the previous raster logo. */
  variant?: BrandLogoVariant;
  /** Kept for API compatibility with the previous raster logo. */
  priority?: boolean;
  /** Hide the wordmark below the `sm` breakpoint (compact mobile chrome). */
  compactOnMobile?: boolean;
}

const sizeStyles: Record<BrandLogoSize, { mark: string; word: string; gap: string }> = {
  sm: { mark: "h-7 w-7", word: "text-[1.05rem]", gap: "gap-2" },
  md: { mark: "h-8 w-8 sm:h-9 sm:w-9", word: "text-[1.15rem] sm:text-[1.3rem]", gap: "gap-2" },
  lg: { mark: "h-11 w-11", word: "text-[1.7rem]", gap: "gap-2.5" },
  xl: { mark: "h-14 w-14 sm:h-16 sm:w-16", word: "text-[2.1rem] sm:text-[2.5rem]", gap: "gap-3" },
};

/**
 * The VerifyMzansi mark: an emerald shield carrying a check, with a marigold
 * sun rising at its shoulder — trust, with a little Mzansi warmth.
 */
export function BrandMark({
  className,
  title,
  cutout = true,
}: {
  className?: string;
  title?: string;
  /** Outline the sun with the page background so it reads as a cut-out. */
  cutout?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const shieldId = `vm-shield-${id}`;
  const shineId = `vm-shine-${id}`;

  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={shieldId} x1="8" y1="3" x2="33" y2="37" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1fae7a" />
          <stop offset="1" stopColor="#07573f" />
        </linearGradient>
        <linearGradient id={shineId} x1="20" y1="3" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M20 2.6 33.4 7.3a2 2 0 0 1 1.35 1.9v9.6c0 8.9-6.2 15.9-14 18.6a2.3 2.3 0 0 1-1.5 0C11.45 34.7 5.25 27.7 5.25 18.8V9.2A2 2 0 0 1 6.6 7.3Z"
        fill={`url(#${shieldId})`}
      />
      <path
        d="M20 2.6 33.4 7.3a2 2 0 0 1 1.35 1.9v4.4C27 16.6 14 17.9 5.25 16V9.2A2 2 0 0 1 6.6 7.3Z"
        fill={`url(#${shineId})`}
      />
      <path
        d="m12.6 20.2 5 5 9.8-11"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="32.2"
        cy="8.2"
        r="5.2"
        fill="#f9a826"
        stroke={cutout ? "hsl(var(--background))" : "none"}
        strokeWidth="2"
      />
    </svg>
  );
}

export function BrandLogo({
  className,
  imageClassName,
  size = "md",
  layout = "horizontal",
  tone = "default",
  compactOnMobile = false,
}: BrandLogoProps) {
  const styles = sizeStyles[size];
  const inverse = tone === "inverse";

  return (
    <span
      role="img"
      aria-label="VerifyMzansi logo"
      className={cn(
        "inline-flex items-center",
        styles.gap,
        layout === "stacked" && "flex-col justify-center text-center",
        className
      )}
    >
      <BrandMark cutout={!inverse} className={cn("shrink-0", styles.mark, imageClassName)} />
      <span
        aria-hidden="true"
        className={cn(
          "font-display font-extrabold leading-none tracking-[-0.035em]",
          styles.word,
          compactOnMobile && "hidden min-[400px]:inline",
          inverse ? "text-white" : "text-foreground"
        )}
      >
        Verify
        <span
          className={
            inverse ? "text-brand-green-300" : "text-brand-green-600 dark:text-brand-green-400"
          }
        >
          Mzansi
        </span>
      </span>
    </span>
  );
}

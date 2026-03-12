"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoSize = "sm" | "md" | "lg" | "xl";
type BrandLogoLayout = "horizontal" | "stacked";
type BrandLogoTone = "default" | "inverse";

const BRAND_LOGO_ASSET_VERSION = "20260312-logo-refresh";
const COMPACT_LOGO_ICON_SRC = "/icons/icon-192.png?v=9";

interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
  size?: BrandLogoSize;
  layout?: BrandLogoLayout;
  tone?: BrandLogoTone;
  priority?: boolean;
}

const sizeStyles: Record<
  BrandLogoSize,
  {
    container: string;
    sizes: string;
    compactIcon: string;
    compactWordmark: string;
    compactGap: string;
  }
> = {
  sm: {
    container: "w-[112px] sm:w-[124px]",
    sizes: "(max-width: 640px) 112px, 124px",
    compactIcon: "h-9 w-9 sm:h-10 sm:w-10",
    compactWordmark: "text-[1.4rem] sm:text-[1.55rem] tracking-[-0.045em]",
    compactGap: "gap-2",
  },
  md: {
    container: "w-[148px] sm:w-[184px]",
    sizes: "(max-width: 640px) 148px, 184px",
    compactIcon: "h-10 w-10 sm:h-12 sm:w-12",
    compactWordmark: "text-[1.65rem] sm:text-[1.9rem] tracking-[-0.05em]",
    compactGap: "gap-2.5 sm:gap-3",
  },
  lg: {
    container: "w-[220px] sm:w-[264px]",
    sizes: "(max-width: 640px) 220px, 264px",
    compactIcon: "h-16 w-16",
    compactWordmark: "text-[2.25rem] tracking-[-0.055em]",
    compactGap: "gap-3",
  },
  xl: {
    container: "w-[280px] sm:w-[360px] lg:w-[420px]",
    sizes: "(max-width: 640px) 280px, (max-width: 1024px) 360px, 420px",
    compactIcon: "h-20 w-20",
    compactWordmark: "text-[2.75rem] tracking-[-0.06em]",
    compactGap: "gap-4",
  },
};

export function BrandLogo({
  className,
  imageClassName,
  size = "md",
  layout = "horizontal",
  tone = "default",
  priority = false,
}: BrandLogoProps) {
  const styles = sizeStyles[size];
  const isCompact = size === "sm" || size === "md";
  const isInverse = tone === "inverse";
  const logoSrc = isInverse
    ? `/images/logo-inverse.png?v=${BRAND_LOGO_ASSET_VERSION}`
    : `/images/logo-transparent.png?v=${BRAND_LOGO_ASSET_VERSION}`;

  if (isCompact) {
    return (
      <div
        className={cn(
          "inline-flex items-center",
          layout === "stacked" ? "flex-col justify-center text-center" : "flex-row",
          styles.compactGap,
          className
        )}
      >
        <Image
          src={COMPACT_LOGO_ICON_SRC}
          alt="VerifyMzansi shield"
          width={176}
          height={176}
          priority={priority}
          className={cn(
            "h-auto shrink-0 object-contain",
            styles.compactIcon,
            isInverse ? "drop-shadow-[0_14px_32px_rgba(0,0,0,0.28)]" : undefined,
            imageClassName
          )}
        />

        <div className={cn("flex flex-col", layout === "stacked" ? "items-center" : "items-start")}>
          <span
            className={cn(
              "font-display font-semibold leading-none",
              styles.compactWordmark,
              isInverse ? "text-white" : "text-foreground"
            )}
          >
            <span>Verify </span>
            <span className={isInverse ? "text-brand-green-300" : "text-brand-green-700"}>
              Mzansi
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex",
        styles.container,
        layout === "stacked" && "justify-center",
        className
      )}
    >
      <Image
        src={logoSrc}
        alt="VerifyMzansi logo"
        width={516}
        height={145}
        sizes={styles.sizes}
        priority={priority}
        className={cn(
          "h-auto w-full object-contain",
          tone === "inverse" ? "drop-shadow-[0_18px_48px_rgba(0,0,0,0.28)]" : undefined,
          imageClassName
        )}
      />
    </div>
  );
}

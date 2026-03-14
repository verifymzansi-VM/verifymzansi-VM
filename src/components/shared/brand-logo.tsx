"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoSize = "sm" | "md" | "lg" | "xl";
type BrandLogoLayout = "horizontal" | "stacked";
type BrandLogoTone = "default" | "inverse";
type BrandLogoVariant = "solid" | "transparent";

const BRAND_LOGO_ASSET_VERSION = "20260312-logo-refresh";

interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
  size?: BrandLogoSize;
  layout?: BrandLogoLayout;
  tone?: BrandLogoTone;
  variant?: BrandLogoVariant;
  priority?: boolean;
}

const sizeStyles: Record<BrandLogoSize, { container: string; sizes: string }> = {
  sm: {
    container: "w-[112px] sm:w-[124px]",
    sizes: "(max-width: 640px) 112px, 124px",
  },
  md: {
    container: "w-[168px] sm:w-[208px]",
    sizes: "(max-width: 640px) 168px, 208px",
  },
  lg: {
    container: "w-[220px] sm:w-[264px]",
    sizes: "(max-width: 640px) 220px, 264px",
  },
  xl: {
    container: "w-[280px] sm:w-[360px] lg:w-[420px]",
    sizes: "(max-width: 640px) 280px, (max-width: 1024px) 360px, 420px",
  },
};

export function BrandLogo({
  className,
  imageClassName,
  size = "md",
  layout = "horizontal",
  tone = "default",
  variant = "solid",
  priority = false,
}: BrandLogoProps) {
  const styles = sizeStyles[size];
  const logoSrc =
    tone === "inverse"
      ? `/images/logo-inverse.png?v=${BRAND_LOGO_ASSET_VERSION}`
      : variant === "transparent"
        ? `/images/logo-transparent.png?v=${BRAND_LOGO_ASSET_VERSION}`
        : `/images/logo.png?v=${BRAND_LOGO_ASSET_VERSION}`;

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

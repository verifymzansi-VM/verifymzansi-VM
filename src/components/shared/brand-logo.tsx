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
    container: "w-[128px] sm:w-[144px]",
    sizes: "(max-width: 640px) 128px, 144px",
  },
  md: {
    container: "w-[188px] sm:w-[232px]",
    sizes: "(max-width: 640px) 188px, 232px",
  },
  lg: {
    container: "w-[248px] sm:w-[296px]",
    sizes: "(max-width: 640px) 248px, 296px",
  },
  xl: {
    container: "w-[320px] sm:w-[400px] lg:w-[460px]",
    sizes: "(max-width: 640px) 320px, (max-width: 1024px) 400px, 460px",
  },
};

export function BrandLogo({
  className,
  imageClassName,
  size = "md",
  layout = "horizontal",
  tone = "default",
  variant = "transparent",
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

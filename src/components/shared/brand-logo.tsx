"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoSize = "sm" | "md" | "lg" | "xl";
type BrandLogoLayout = "horizontal" | "stacked";
type BrandLogoTone = "default" | "inverse";

interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
  wordmarkClassName?: string;
  accentClassName?: string;
  size?: BrandLogoSize;
  layout?: BrandLogoLayout;
  tone?: BrandLogoTone;
  priority?: boolean;
  showAccent?: boolean;
  showDescriptor?: boolean;
}

const sizeStyles: Record<
  BrandLogoSize,
  { icon: string; wordmark: string; accent: string; descriptor: string }
> = {
  sm: {
    icon: "h-5 w-5",
    wordmark: "text-base tracking-[-0.045em]",
    accent: "mt-1 h-0.5 w-7",
    descriptor: "text-[0.55rem] tracking-[0.28em]",
  },
  md: {
    icon: "h-9 w-9 sm:h-12 sm:w-12",
    wordmark: "text-[1.6rem] sm:text-[1.9rem] tracking-[-0.05em]",
    accent: "mt-1.5 h-0.5 w-10",
    descriptor: "text-[0.62rem] tracking-[0.34em]",
  },
  lg: {
    icon: "h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]",
    wordmark: "text-[2.4rem] sm:text-[3rem] tracking-[-0.055em]",
    accent: "mt-2 h-1 w-12",
    descriptor: "text-[0.68rem] tracking-[0.38em]",
  },
  xl: {
    icon: "h-24 w-24 sm:h-32 sm:w-32 lg:h-36 lg:w-36",
    wordmark: "text-4xl sm:text-5xl lg:text-6xl tracking-[-0.06em]",
    accent: "mt-3 h-1 w-14",
    descriptor: "text-[0.75rem] tracking-[0.4em]",
  },
};

export function BrandLogo({
  className,
  imageClassName,
  wordmarkClassName,
  accentClassName,
  size = "md",
  layout = "horizontal",
  tone = "default",
  priority = false,
  showAccent = true,
  showDescriptor = false,
}: BrandLogoProps) {
  const styles = sizeStyles[size];
  const isInverse = tone === "inverse";

  return (
    <div
      className={cn(
        "inline-flex items-center",
        layout === "stacked" ? "flex-col text-center" : "flex-row",
        size === "sm" ? "gap-2" : layout === "stacked" ? "gap-3 sm:gap-4" : "gap-2.5 sm:gap-3",
        className
      )}
    >
      <Image
        src="/icons/icon-192.png?v=9"
        alt="VerifyMzansi shield"
        width={176}
        height={176}
        priority={priority}
        className={cn(
          "shrink-0 object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.12)]",
          styles.icon,
          imageClassName
        )}
      />

      <div className={cn("flex flex-col", layout === "stacked" ? "items-center" : "items-start")}>
        {showDescriptor ? (
          <span
            className={cn(
              "mb-1 font-medium uppercase leading-none",
              styles.descriptor,
              isInverse ? "text-white/65" : "text-foreground/50"
            )}
          >
            Trusted Marketplace
          </span>
        ) : null}

        <span
          className={cn(
            "font-display font-semibold leading-none",
            styles.wordmark,
            wordmarkClassName
          )}
        >
          <span className={isInverse ? "text-white" : "text-foreground"}>Verify</span>
          <span className={isInverse ? "text-brand-green-300" : "text-brand-green-700"}>
            Mzansi
          </span>
        </span>

        {showAccent ? (
          <span
            aria-hidden="true"
            className={cn(
              "rounded-full bg-[linear-gradient(90deg,#ffb81c_0%,#ffb81c_18%,#00833e_76%,#006b32_100%)]",
              styles.accent,
              isInverse ? "opacity-95" : "opacity-90",
              accentClassName
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

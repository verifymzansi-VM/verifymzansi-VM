import { BrandMark } from "@/components/brand/brand-mark";

type BrandLogoSize = "sm" | "md" | "lg" | "xl";
type BrandLogoLayout = "horizontal" | "stacked";
/** "auto" follows the light/dark theme; "inverse" is for dark-green surfaces. */
type BrandLogoTone = "default" | "inverse" | "auto";
type BrandLogoVariant = "solid" | "transparent";

interface BrandLogoProps {
  className?: string;
  /** Applied to the shield image. */
  imageClassName?: string;
  size?: BrandLogoSize;
  /** Kept for API compatibility; the mark is always horizontal. */
  layout?: BrandLogoLayout;
  tone?: BrandLogoTone;
  /** Kept for API compatibility; the mark has no background. */
  variant?: BrandLogoVariant;
  priority?: boolean;
  /** Render with no accessible name, when a wrapping link already names it. */
  decorative?: boolean;
}

/**
 * Site logo. Renders the shield + live-text BrandMark so the wordmark stays
 * sharp at every size (the old raster logo blurred its tagline).
 */
export function BrandLogo({
  className,
  imageClassName,
  size = "md",
  tone = "auto",
  priority = false,
  decorative = false,
}: BrandLogoProps) {
  return (
    <BrandMark
      size={size === "xl" ? "lg" : size}
      inverse={tone === "inverse"}
      priority={priority}
      decorative={decorative}
      className={className}
      shieldClassName={imageClassName}
    />
  );
}

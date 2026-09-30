import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SaFlagStripe } from "./sa-flag-stripe";

type BrandGlow = "green" | "gold";

const GLOWS: Record<BrandGlow, string> = {
  green:
    "bg-[radial-gradient(ellipse_at_top_left,rgba(20,154,107,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(8,98,74,0.45),transparent_60%)]",
  gold: "bg-[radial-gradient(ellipse_at_top_left,rgba(249,168,38,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(8,98,74,0.45),transparent_60%)]",
};

type BrandSurfaceProps = {
  as?: "div" | "section" | "aside" | "header";
  children: ReactNode;
  glow?: BrandGlow;
  /** Flag-colour rule along the bottom edge. */
  stripe?: boolean;
} & ComponentPropsWithoutRef<"section">;

/**
 * The deep-green brand surface: brand-green-950 base, soft radial glows, a faint
 * Mzansi pattern and (by default) the flag stripe. Content is white on it.
 */
export function BrandSurface({
  as: Tag = "div",
  children,
  glow = "green",
  stripe = true,
  className,
  ...rest
}: BrandSurfaceProps) {
  return (
    <Tag
      className={cn("relative isolate overflow-hidden bg-brand-green-950 text-white", className)}
      {...rest}
    >
      <div aria-hidden="true" className={cn("absolute inset-0 -z-10", GLOWS[glow])} />
      <div
        aria-hidden="true"
        className="mzansi-pattern pointer-events-none absolute inset-0 -z-10 opacity-[0.05] invert [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
      />
      {children}
      {stripe && <SaFlagStripe className="absolute inset-x-0 bottom-0" />}
    </Tag>
  );
}

/** Secondary (outline) buttons placed on a BrandSurface. */
export const brandOutlineButtonClassName =
  "border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white focus-visible:ring-white";

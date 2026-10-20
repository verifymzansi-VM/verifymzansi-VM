import Image from "next/image";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND_SHIELD_LARGE_SRC } from "./brand-mark";
import { WaterSurface } from "./water-surface";

/** "fit" sizes the emblem from the viewport height so a full-screen panel never scrolls. */
type EmblemSize = "md" | "lg" | "fit";

/** One length, --emblem, sizes every layer; the layout lives in .emblem-* in globals.css. */
const EMBLEM_SIZE = {
  lg: "[--emblem:17rem] xl:[--emblem:20rem]",
  md: "[--emblem:14rem]",
  fit: "[--emblem:clamp(8rem,36vh,20rem)]",
} as const;

/**
 * The checks behind a post, in the brand-banner wording. "Reviewed", not
 * "checked": our team reviews the ID and selfie; there is no Home Affairs check.
 * The CIPC check only applies to registered businesses that ask for it.
 */
const CHECKS = ["Poster ID reviewed", "Phone verified", "CIPC registered*"] as const;

const CIPC_FOOTNOTE = "*CIPC check applies to registered businesses that request it.";

/** Gold-tick pill from the brand banner. */
function CheckChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-white/85 bg-brand-green-950/60 py-1 pl-1 pr-3 text-[13px] font-bold text-white",
        className
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-gold-300 text-brand-green-950">
        <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3.5} />
      </span>
      {label}
    </span>
  );
}

/** The three checks as a row, with the CIPC footnote underneath. */
export function VerificationChips({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ul aria-label="What we check" className="flex flex-wrap gap-2">
        {CHECKS.map((label) => (
          <li key={label}>
            <CheckChip label={label} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/70">{CIPC_FOOTNOTE}</p>
    </div>
  );
}

/**
 * Shield centrepiece for BrandSurface, seen from above: the gold shield drops
 * flat onto still water, the splash rings out across the whole green surface
 * and the shield bobs there, sending a ripple each time it settles. Unless
 * `chips` is false, the checks a poster passes sit around it. Decorative; the
 * surrounding copy carries the meaning.
 */
export function VerificationEmblem({
  size = "lg",
  chips = true,
  className,
}: {
  size?: EmblemSize;
  chips?: boolean;
  className?: string;
}) {
  const lg = size !== "md";
  return (
    <div
      aria-hidden="true"
      data-emblem
      className={cn(
        "relative",
        EMBLEM_SIZE[size],
        chips
          ? lg
            ? "h-[18rem] w-[26rem] xl:h-[21rem] xl:w-[30rem]"
            : "h-[15rem] w-[23rem]"
          : "h-[var(--emblem)] w-[var(--emblem)]",
        className
      )}
    >
      <WaterSurface />
      <Image
        src={BRAND_SHIELD_LARGE_SRC}
        alt=""
        width={176}
        height={176}
        unoptimized
        className="emblem-shield"
      />

      {chips && (
        <>
          <CheckChip label={CHECKS[0]} className={cn("absolute left-0", lg ? "top-10" : "top-6")} />
          <CheckChip
            label={CHECKS[1]}
            className={cn("absolute right-0", lg ? "bottom-16" : "bottom-[4.75rem]")}
          />
          <CheckChip label={CHECKS[2]} className="absolute bottom-6 left-1/2 -translate-x-1/2" />
          <p className="absolute inset-x-0 bottom-0 text-center text-[11px] text-white/65">
            {CIPC_FOOTNOTE}
          </p>
        </>
      )}
    </div>
  );
}

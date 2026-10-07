import Image from "next/image";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND_SHIELD_LARGE_SRC } from "./brand-mark";

type EmblemSize = "md" | "lg";

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
 * Shield centrepiece for BrandSurface: gold rings, the shield and, unless
 * `chips` is false, the checks a poster passes. Decorative; the surrounding
 * copy carries the meaning.
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
  const lg = size === "lg";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative",
        chips
          ? lg
            ? "h-[18rem] w-[26rem] xl:h-[21rem] xl:w-[30rem]"
            : "h-[15rem] w-[23rem]"
          : lg
            ? "h-[17rem] w-[17rem] xl:h-[20rem] xl:w-[20rem]"
            : "h-[14rem] w-[14rem]",
        className
      )}
    >
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-gold-400/20 blur-3xl",
          lg ? "h-56 w-56 xl:h-64 xl:w-64" : "h-44 w-44"
        )}
      />
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-gold-300/35",
          lg ? "h-[17rem] w-[17rem] xl:h-[20rem] xl:w-[20rem]" : "h-[14rem] w-[14rem]"
        )}
      />
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-gold-300/50 bg-brand-green-900/40",
          lg ? "h-48 w-48 xl:h-56 xl:w-56" : "h-40 w-40"
        )}
      />
      <Image
        src={BRAND_SHIELD_LARGE_SRC}
        alt=""
        width={176}
        height={176}
        unoptimized
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
          lg ? "h-36 w-36 xl:h-44 xl:w-44" : "h-28 w-28"
        )}
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

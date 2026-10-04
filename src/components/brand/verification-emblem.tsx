import Image from "next/image";
import { BadgeCheck, Check, IdCard, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND_SHIELD_SRC } from "./brand-mark";

type EmblemSize = "md" | "lg";

/**
 * Shield centrepiece for BrandSurface: glowing rings, the shield, and the checks
 * a seller passes. Decorative; the surrounding copy carries the meaning.
 */
export function VerificationEmblem({
  size = "lg",
  className,
}: {
  size?: EmblemSize;
  className?: string;
}) {
  const lg = size === "lg";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative",
        lg ? "h-[18rem] w-[26rem] xl:h-[21rem] xl:w-[30rem]" : "h-[15rem] w-[23rem]",
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
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10",
          lg ? "h-[17rem] w-[17rem] xl:h-[20rem] xl:w-[20rem]" : "h-[14rem] w-[14rem]"
        )}
      />
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-brand-green-900/40",
          lg ? "h-48 w-48 xl:h-56 xl:w-56" : "h-40 w-40"
        )}
      />
      <Image
        src={BRAND_SHIELD_SRC}
        alt=""
        width={176}
        height={176}
        unoptimized
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
          lg ? "h-36 w-36 xl:h-44 xl:w-44" : "h-28 w-28"
        )}
      />

      <EmblemChip
        icon={Smartphone}
        label="Phone verified"
        className={lg ? "left-0 top-10" : "left-0 top-6"}
      />
      <EmblemChip
        icon={IdCard}
        label="SA ID checked"
        className={lg ? "bottom-16 right-0" : "bottom-12 right-0"}
      />
      <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-gold-300 px-3.5 py-1.5 text-[13px] font-bold text-brand-gold-950 shadow-[0_10px_30px_rgba(249,168,38,0.35)]">
        <BadgeCheck className="h-4 w-4" />
        Verified seller
      </span>
    </div>
  );
}

function EmblemChip({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof Smartphone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "absolute inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 bg-brand-green-900 py-1.5 pl-1.5 pr-3 text-[13px] font-semibold text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-brand-green-300">
        <Icon className="h-4 w-4" />
      </span>
      {label}
      <Check className="h-4 w-4 text-brand-green-300" strokeWidth={3} />
    </span>
  );
}

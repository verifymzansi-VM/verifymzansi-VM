import Image from "next/image";
import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A sponsor logo on a white rounded tile. `src` is only ever set when written
 * logo permission is on record (public_sponsor_directory nulls it otherwise);
 * without it the tile shows a neutral emblem rather than the brand.
 */
export function SponsorLogo({
  src,
  name,
  size = 32,
  className,
}: {
  src: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-black/5",
        className
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image
          src={src}
          alt={`${name} logo`}
          width={size}
          height={size}
          className="h-full w-full object-contain p-0.5"
          unoptimized
        />
      ) : (
        <Landmark aria-hidden="true" className="h-1/2 w-1/2 text-brand-green-700" />
      )}
    </span>
  );
}

import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * A real CoR14.3 Registration Certificate rendered from CIPC's PDF, with every
 * personal detail removed (grey bars mark where values go), marking the parts
 * we read. Shown wherever an owner chooses what to upload.
 */

const EXAMPLE_SRC = "/images/help/cipc-cor14-3-example.webp?v=20261020b";
const EXAMPLE_WIDTH = 1104;
const EXAMPLE_HEIGHT = 1297;

/** Marker positions are percentages of the example image. */
const CALLOUTS = [
  { n: 1, x: 43, y: 25.4, label: "Company name", note: "shown as your registered name" },
  { n: 2, x: 26.5, y: 11.9, label: "Registration number", note: "checked with CIPC" },
  { n: 3, x: 40.6, y: 36.6, label: "Status", note: "must say In Business" },
  { n: 4, x: 90.6, y: 44.4, label: "Registered office", note: "can become your business address" },
  {
    n: 5,
    x: 34.6,
    y: 57.2,
    label: "Directors and ID numbers",
    note: "matched to your verified ID, never stored",
  },
] as const;

function Marker({
  n,
  className,
  style,
}: {
  n: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-gold-400 text-[11px] font-bold leading-none text-brand-green-950 ring-2 ring-white",
        className
      )}
    >
      {n}
    </span>
  );
}

export function CipcDocumentGuide({ className }: { className?: string }) {
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-border", className)}>
      <div className="relative bg-white">
        <Image
          src={EXAMPLE_SRC}
          width={EXAMPLE_WIDTH}
          height={EXAMPLE_HEIGHT}
          sizes="(max-width: 960px) 100vw, 896px"
          alt="Example CIPC CoR14.3 Registration Certificate with personal details removed"
          className="h-auto w-full"
        />
        {CALLOUTS.map((c) => (
          <Marker
            key={c.n}
            n={c.n}
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-[10px] shadow sm:h-5 sm:w-5 sm:text-[11px]"
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
          />
        ))}
      </div>

      <figcaption className="space-y-2 border-t border-border bg-card p-3 text-sm sm:p-4">
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {CALLOUTS.map((c) => (
            <li key={c.n} className="flex items-start gap-2">
              <Marker n={c.n} className="mt-px ring-0" />
              <span>
                <span className="font-medium">{c.label}</span>{" "}
                <span className="text-muted-foreground">— {c.note}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          A real CoR14.3 with personal details removed. A CIPC disclosure works too.
        </p>
      </figcaption>
    </figure>
  );
}

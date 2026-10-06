import { Building2, Eye, IdCard } from "lucide-react";

import type { BusinessStickerState } from "@/lib/business-verification/public";
import { cn } from "@/lib/utils";

function monthYear(iso: string): string {
  // Fixed time zone: server (UTC) and browser render the same month.
  return new Date(iso).toLocaleDateString("en-ZA", {
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

/** Visible short names on the larger (profile) stickers; touch has no hover. */
const SHORT = { id: "ID reviewed", cipc: "CIPC registered", seen: "Seen" } as const;

/** Tooltip copy for each sticker, in display order. Missing stickers are omitted. */
function businessStickerLabels(state: BusinessStickerState): Array<{
  key: "id" | "cipc" | "seen";
  label: string;
}> {
  const labels: Array<{ key: "id" | "cipc" | "seen"; label: string }> = [];
  if (state.idReviewed) labels.push({ key: "id", label: "ID reviewed" });
  if (state.cipcCheckedAt) {
    labels.push({
      key: "cipc",
      label: `CIPC registered · checked ${monthYear(state.cipcCheckedAt)}`,
    });
  }
  if (state.seenAt) {
    const where =
      state.seenMethod === "visit"
        ? `Visited${state.seenCity ? ` in ${state.seenCity}` : ""}`
        : "Seen on live video";
    labels.push({ key: "seen", label: `${where} · ${monthYear(state.seenAt)}` });
  }
  return labels;
}

const ICONS = { id: IdCard, cipc: Building2, seen: Eye } as const;

/**
 * Up to three verification stickers, icon-first with a tooltip each:
 * ID reviewed, CIPC registered, Seen by VerifyMzansi. Nothing renders for a
 * sticker the business does not hold.
 */
export function BusinessStickers({
  state,
  size = "sm",
  className,
}: {
  state: BusinessStickerState;
  size?: "sm" | "md";
  className?: string;
}) {
  const labels = businessStickerLabels(state);
  if (!labels.length) return null;
  const box = size === "md" ? "h-8 w-8" : "h-6 w-6";
  const icon = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  return (
    <ul
      aria-label="Verification"
      className={cn("flex flex-wrap items-center gap-1", size === "md" && "gap-1.5", className)}
    >
      {labels.map(({ key, label }) => {
        const Icon = ICONS[key];
        return (
          <li key={key}>
            {size === "md" ? (
              <span
                title={label}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-green-700 px-3 text-xs font-semibold text-brand-gold-200 ring-1 ring-brand-gold-400/50 dark:bg-brand-green-800"
              >
                <Icon aria-hidden="true" className={icon} />
                <span aria-hidden="true">{SHORT[key]}</span>
                <span className="sr-only">{label}</span>
              </span>
            ) : (
              <span
                title={label}
                className={cn(
                  "inline-flex items-center justify-center rounded-full bg-brand-green-700 text-brand-gold-300 ring-1 ring-brand-gold-400/50 dark:bg-brand-green-800",
                  box
                )}
              >
                <Icon aria-hidden="true" className={icon} />
                <span className="sr-only">{label}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

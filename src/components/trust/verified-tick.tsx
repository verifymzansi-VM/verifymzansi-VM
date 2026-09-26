import { cn } from "@/lib/utils";

interface VerifiedTickProps {
  className?: string;
  /** Accessible label; defaults to the legally careful "ID reviewed" wording. */
  label?: string;
  /** Marigold ring for the Pro tier. */
  pro?: boolean;
  /** Hide from assistive tech when adjacent text already states the status. */
  decorative?: boolean;
}

/**
 * Compact, social-style verification tick shown beside a person or business
 * name. It complements (never replaces) the labelled TrustBadge on detail pages.
 */
export function VerifiedTick({
  className,
  label = "ID reviewed",
  pro = false,
  decorative = false,
}: VerifiedTickProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      className={cn("inline-block h-4 w-4 shrink-0", className)}
    >
      {decorative ? null : <title>{label}</title>}
      <path
        d="M12 1.6 20.3 4.5a1.3 1.3 0 0 1 .87 1.23v5.8c0 5.4-3.7 9.8-8.7 11.3a1.6 1.6 0 0 1-.94 0C6.53 21.33 2.83 16.93 2.83 11.53v-5.8A1.3 1.3 0 0 1 3.7 4.5Z"
        fill={pro ? "#f9a826" : "#0b7a55"}
      />
      <path
        d="m7.9 12 2.9 2.9 5.4-5.8"
        fill="none"
        stroke={pro ? "#411904" : "#fff"}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * The home page's one slim line under the showroom: what VerifyMzansi checks,
 * with a link to the details. Same small pill as the showroom's province chip,
 * so clients' posts stay the first thing on the screen.
 */
export function HomeIdentityLine() {
  return (
    <div className="flex justify-center px-4 py-2.5">
      <p className="inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-card pl-3.5 text-xs font-medium text-foreground shadow-xs">
        <ShieldCheck
          className="h-3.5 w-3.5 shrink-0 text-brand-green-700 dark:text-brand-gold-300"
          aria-hidden="true"
        />
        <span className="truncate">Every poster ID-reviewed</span>
        <span className="shrink-0 text-slate-500 dark:text-white/60" aria-hidden="true">
          ·
        </span>
        <Link
          href="/help/business-verification"
          prefetch={false}
          className="inline-flex h-full shrink-0 items-center rounded-r-full pr-3.5 font-semibold text-brand-green-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-gold-300"
        >
          What we check
        </Link>
      </p>
    </div>
  );
}

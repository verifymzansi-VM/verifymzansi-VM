import Link from "next/link";
import { AlertTriangle } from "lucide-react";

interface VerificationAlertBannerProps {
  pendingCount: number;
}

/**
 * Prominent alert banner shown on admin pages when verification
 * requests are awaiting review. Server-rendered.
 */
export function VerificationAlertBanner({ pendingCount }: VerificationAlertBannerProps) {
  if (pendingCount <= 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            Verification Requests Pending
          </h3>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
            {pendingCount} verification {pendingCount === 1 ? "request" : "requests"} awaiting
            review. Review promptly to maintain platform trust.
          </p>
        </div>
        <Link
          href="/admin/verification"
          className="flex-shrink-0 inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
        >
          Review Now
        </Link>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatSaLongDate } from "@/lib/utils/format";

/**
 * Shown when the middleware redirects a suspended member to the dashboard
 * (`?suspended=true&until=...`): what happened, until when, and how to appeal.
 */
export function SuspensionNotice() {
  const params = useSearchParams();
  if (params.get("suspended") !== "true") return null;

  const until = params.get("until");
  const untilDate = until && !Number.isNaN(Date.parse(until)) ? formatSaLongDate(until) : null;

  return (
    <div
      role="alert"
      className="mb-5 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      <p className="font-semibold">
        Your account is suspended{untilDate ? ` until ${untilDate}` : ""}.
      </p>
      <p className="mt-1">
        Your listings are hidden and you cannot post until then. If you think this is wrong, you can
        ask for a review.
      </p>
      <Link href="/appeals" className="mt-2 inline-block font-medium underline">
        See the decision and appeal
      </Link>
    </div>
  );
}

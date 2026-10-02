"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { postQueue } from "@/components/admin/queue-claims";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";

type Claim = NonNullable<StaffDashboard["shift"]>["claims"][number];
type Queue = Claim["queue"];

const QUEUES: Record<Queue, { label: string; href: string }> = {
  reports: { label: "reports", href: "/admin/reports" },
  kyc: { label: "identity checks", href: "/admin/verification" },
  content: { label: "content items", href: "/admin/moderation" },
};

const ITEM_LABELS: Record<string, string> = {
  report: "Report",
  verification_step: "Identity check",
  listing: "Listing",
  business: "Business",
  promotion: "Tourism or event",
  content_edit: "Content edit",
};

const MAX_RENEWALS = 4;

/** Clock time in South Africa, the same on server and browser. */
function sastTime(iso: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(iso));
}

// A clock that ticks every 30 seconds in the browser, and is absent on the
// server, so the first render matches the server's HTML.
function subscribeClock(onTick: () => void) {
  const timer = setInterval(onTick, 30_000);
  return () => clearInterval(timer);
}
const clockSnapshot = () => Math.floor(Date.now() / 30_000) * 30_000;
const serverClockSnapshot = () => null;

/** Minutes left, updated every 30 seconds once the page is in the browser. */
function useMinutesLeft(expiresAt: string): number | null {
  const now = useSyncExternalStore<number | null>(
    subscribeClock,
    clockSnapshot,
    serverClockSnapshot
  );
  if (now === null) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

function ClaimRow({ claim }: { claim: Claim }) {
  const minutes = useMinutesLeft(claim.expires_at);
  const expiring = minutes !== null && minutes <= 3;
  return (
    <li className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
      <Link
        href={QUEUES[claim.queue].href}
        className="font-medium underline-offset-4 hover:underline"
      >
        {ITEM_LABELS[claim.item_type] ?? claim.item_type}{" "}
        <span className="font-mono text-xs text-muted-foreground">{claim.item_id.slice(0, 8)}</span>
      </Link>
      <span className={expiring ? "font-semibold text-destructive" : "text-muted-foreground"}>
        {minutes === null
          ? `Held until ${sastTime(claim.expires_at)}`
          : minutes === 0
            ? "Expired"
            : `${minutes} min left`}
        {` · ${MAX_RENEWALS - claim.renewals} renewals left`}
      </span>
    </li>
  );
}

export function MyShiftPanel({
  claims,
  canClaim,
  waiting = {},
}: {
  claims: Claim[];
  canClaim: boolean;
  /** Items waiting per queue. The queue with work gets the solid button; empty ones go quiet. */
  waiting?: Partial<Record<Queue, number | null>>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run(key: string, body: Record<string, unknown>, then?: string) {
    setBusy(key);
    setMessage(null);
    try {
      const data = await postQueue(body);
      if (data.message) setMessage(data.message);
      startTransition(() => (then ? router.push(then) : router.refresh()));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {canClaim && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(QUEUES) as Queue[]).map((queue) => {
            const count = waiting[queue];
            const known = typeof count === "number";
            const empty = known && count === 0;
            return (
              <Button
                key={queue}
                size="sm"
                variant={empty ? "outline" : "trust-verified"}
                className={cn("h-11 gap-2", empty && "text-muted-foreground")}
                disabled={busy !== null}
                aria-label={`Claim 10 ${QUEUES[queue].label}`}
                aria-describedby={known ? `claim-${queue}-waiting` : undefined}
                onClick={() =>
                  run(`claim:${queue}`, { action: "claim", queue, limit: 10 }, QUEUES[queue].href)
                }
              >
                {busy === `claim:${queue}` && <Loader2 className="h-4 w-4 animate-spin" />}
                Claim 10 {QUEUES[queue].label}
                {known && (
                  <span
                    id={`claim-${queue}-waiting`}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      empty ? "bg-muted" : "bg-white/20"
                    )}
                  >
                    {empty ? "none waiting" : `${count > 99 ? "99+" : count} waiting`}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {claims.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You are not holding any items. A claim keeps an item yours for 15 minutes, and you can
          extend it 4 times.
        </p>
      ) : (
        <>
          <ul className="space-y-2" aria-label="Items you are holding">
            {claims.map((claim) => (
              <ClaimRow key={`${claim.item_type}:${claim.item_id}`} claim={claim} />
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-11"
              disabled={busy !== null}
              onClick={() => run("renew", { action: "renew" })}
            >
              Keep my items 15 more minutes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-11"
              disabled={busy !== null}
              onClick={() => run("release", { action: "release" })}
            >
              Release all
            </Button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

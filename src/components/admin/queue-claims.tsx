"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import type { ClaimItemType, ClaimQueue, ClaimView } from "@/lib/services/queue-claims";

/**
 * Queue claim state for a queue screen. The server enforces claims on every
 * decision; this only shows who holds what and disables buttons that would
 * be refused anyway.
 */
interface QueueClaimsValue {
  claims: Record<string, ClaimView>;
  /** Moderators must hold a claim to decide. */
  mustClaim: boolean;
  /** Governors and admins can free someone else's claim. */
  canFree: boolean;
}

const QueueClaimsContext = createContext<QueueClaimsValue>({
  claims: {},
  mustClaim: false,
  canFree: false,
});

export function QueueClaimsProvider({
  children,
  ...value
}: QueueClaimsValue & { children: React.ReactNode }) {
  return <QueueClaimsContext.Provider value={value}>{children}</QueueClaimsContext.Provider>;
}

/** Claim state for one item, and whether this viewer may decide it now. */
export function useQueueClaim(type: ClaimItemType, id: string) {
  const { claims, mustClaim } = useContext(QueueClaimsContext);
  const claim = claims[`${type}:${id}`];
  const heldByOther = Boolean(claim && !claim.mine);
  const blocked = heldByOther || (mustClaim && !claim?.mine);
  const blockedReason = heldByOther
    ? `${claim?.holderName ?? "Another moderator"} is working on this`
    : blocked
      ? "Claim items from the queue to decide them"
      : null;
  return { claim, blocked, blockedReason };
}

/** Render-prop form of useQueueClaim for rows rendered inside a map. */
export function ClaimGate({
  type,
  id,
  children,
}: {
  type: ClaimItemType;
  id: string;
  children: (state: { blocked: boolean; blockedReason: string | null }) => React.ReactNode;
}) {
  const { blocked, blockedReason } = useQueueClaim(type, id);
  return <>{children({ blocked, blockedReason })}</>;
}

async function postQueue(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/queue", {
    method: "POST",
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "That did not work. Try again.");
  return data as { message?: string };
}

export function ClaimBadge({ type, id }: { type: ClaimItemType; id: string }) {
  const { canFree } = useContext(QueueClaimsContext);
  const { claim } = useQueueClaim(type, id);
  if (!claim) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={claim.mine ? "default" : "outline"} className="text-[10px]">
        {claim.mine ? "Claimed by you" : `Claimed by ${claim.holderName}`}
      </Badge>
      {!claim.mine && canFree && <FreeClaimButton type={type} id={id} />}
    </span>
  );
}

/** Governors and admins free a claim so anyone can pick the item up. */
function FreeClaimButton({ type, id }: { type: ClaimItemType; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function free() {
    const reason = window.prompt("Why free this item for someone else?");
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    try {
      await postQueue({
        action: "reassign",
        itemType: type,
        itemId: id,
        to: null,
        reason: reason.trim(),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={free} disabled={busy}>
      Free
    </Button>
  );
}

export function QueueClaimBar({
  queue,
  myClaims,
  canClaim,
}: {
  queue: ClaimQueue;
  myClaims: number;
  canClaim: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (!canClaim) return null;

  async function run(action: string, body: Record<string, unknown>) {
    setBusy(action);
    setMessage(null);
    try {
      const data = await postQueue(body);
      if (data.message) setMessage(data.message);
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 text-sm">
      <p className="mr-auto">
        {myClaims === 0
          ? "Claim items to start. Claims last 15 minutes."
          : `You hold ${myClaims} ${myClaims === 1 ? "item" : "items"} in this queue.`}
      </p>
      <Button
        size="sm"
        onClick={() => run("claim", { action: "claim", queue, limit: 10 })}
        disabled={busy !== null}
      >
        {busy === "claim" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Claim next 10
      </Button>
      {myClaims > 0 && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run("renew", { action: "renew" })}
            disabled={busy !== null}
          >
            Keep my items
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run("release", { action: "release" })}
            disabled={busy !== null}
          >
            Release all my items
          </Button>
        </>
      )}
      {message && (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

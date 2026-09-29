"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

export function RoleChangeReviewActions({
  decisionId,
  payloadVersion,
  canApprove,
  canWithdraw,
  blockedReason,
}: {
  decisionId: string;
  payloadVersion: number;
  canApprove: boolean;
  canWithdraw: boolean;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/governance/roles", {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(
        action === "approve" ? { action, decisionId, payloadVersion } : { action, decisionId }
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === "step_up_required" || data.code === "mfa_required") {
        router.push(staffVerifyHref(data.verifyUrl, "/admin/governance/roles"));
        return;
      }
      setError(data.error ?? "The change could not be saved. Try again.");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <Button size="sm" disabled={busy} onClick={() => send("approve")}>
            Approve change
          </Button>
        )}
        {(canApprove || canWithdraw) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send("reject")}>
            {canWithdraw ? "Withdraw proposal" : "Reject change"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

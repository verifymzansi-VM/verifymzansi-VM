"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { AREA_LABELS, type MarketplaceArea } from "@/types/enums";

type Campaign = {
  area: MarketplaceArea;
  slot_limit: number;
  launch_enabled: boolean;
  seven_day_enabled: boolean;
};
type Claim = {
  id: string;
  user_id: string | null;
  area: MarketplaceArea;
  content_id: string;
  duration_days: number;
  activated_at: string | null;
  expires_at: string | null;
  released_at: string | null;
  converted_at: string | null;
};
type Summary = {
  area: MarketplaceArea;
  active: number;
  started7: number;
  started30: number;
  expired: number;
  converted: number;
  revoked: number;
  conversionRate: number;
};
export function TrialManagement({
  campaigns,
  claims,
  summary,
}: {
  campaigns: Campaign[];
  claims: Claim[];
  summary: Summary[];
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(action: string, target: string, values: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/trials", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action, target, values, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Change failed");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6 p-4">
      <h1 className="text-2xl font-bold">Free Trial Management</h1>
      <p className="text-sm text-muted-foreground">
        One introductory choice per verified identity. Capacity counts active 30-day trials; paid
        and staff posts are excluded. Changes are audited.
      </p>
      <label className="block">
        Reason for change
        <input
          className="block w-full rounded border p-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={500}
          placeholder="Explain the support or campaign decision"
        />
      </label>
      {message && <p role="alert">{message}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        {campaigns.map((c) => {
          const stats = summary.find((s) => s.area === c.area);
          return (
            <form
              key={c.area}
              className="rounded border p-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void save("configure", c.area, {
                  slotLimit: Number(data.get("limit")),
                  launchEnabled: data.has("launch"),
                  sevenDayEnabled: data.has("seven"),
                });
              }}
            >
              <h2 className="font-semibold">{AREA_LABELS[c.area]}</h2>
              <p>
                {stats?.active ?? 0} active / {c.slot_limit} slots ·{" "}
                {Math.max(0, c.slot_limit - (stats?.active ?? 0))} available
              </p>
              <label className="block">
                30-day slot limit{" "}
                <input
                  aria-label={`${AREA_LABELS[c.area]} slot limit`}
                  className="w-20 border p-1"
                  type="number"
                  name="limit"
                  min={0}
                  max={500}
                  required
                  defaultValue={c.slot_limit}
                />
              </label>
              <label className="block">
                <input type="checkbox" name="launch" defaultChecked={c.launch_enabled} /> Enable
                30-day offer
              </label>
              <label className="block">
                <input type="checkbox" name="seven" defaultChecked={c.seven_day_enabled} /> Enable
                7-day offer
              </label>
              <p className="text-sm">
                Started: {stats?.started7 ?? 0} seven-day / {stats?.started30 ?? 0} launch ·
                Expired: {stats?.expired ?? 0} · Paid renewals: {stats?.converted ?? 0} ·
                Conversion: {stats?.conversionRate ?? 0}% · Revoked: {stats?.revoked ?? 0}
              </p>
              <Button disabled={busy || reason.trim().length < 5}>Save campaign</Button>
            </form>
          );
        })}
      </div>
      <h2 className="text-lg font-semibold">Latest 100 trial submissions</h2>
      <p className="text-sm">
        Conversion uses all activated trials as its denominator. Extensions apply only to active
        30-day trials and cannot exceed 60 days from activation.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Area / member</th>
              <th>Trial</th>
              <th>Expiry</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-2">
                  {AREA_LABELS[t.area]}
                  <br />
                  {t.user_id ?? "Deleted account"}
                  <br />
                  <Link className="underline" href="/admin/moderation">
                    Post: {t.content_id}
                  </Link>
                </td>
                <td>
                  {t.duration_days} days ·{" "}
                  {t.converted_at
                    ? "Paid"
                    : t.released_at
                      ? "Released"
                      : t.activated_at
                        ? "Activated"
                        : "Pending"}
                </td>
                <td>
                  {t.expires_at
                    ? new Date(t.expires_at).toLocaleString("en-ZA")
                    : "Starts on approval"}
                </td>
                <td className="p-2 space-y-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!t.released_at || reason.trim().length < 5}
                    onClick={() => save("revoke", t.id, {})}
                  >
                    Revoke
                  </Button>
                  {t.duration_days === 30 &&
                    t.activated_at &&
                    !t.released_at &&
                    !t.converted_at && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          void save("extend", t.id, {
                            expiresAt: new Date(String(data.get("expiry"))).toISOString(),
                          });
                        }}
                      >
                        <input
                          aria-label="New trial expiry"
                          type="datetime-local"
                          name="expiry"
                          required
                        />
                        <Button size="sm" disabled={busy || reason.trim().length < 5}>
                          Extend
                        </Button>
                      </form>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

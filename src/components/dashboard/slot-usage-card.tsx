import Link from "next/link";
import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface SlotUsageEntry {
  id: string;
  source: string;
  area: string | null;
  planName: string | null;
  status: string;
  slotCapacity: number;
  activeUsage: number;
  activationCount: number;
  activationLimitTotal: number | null;
  activationLimitPerPeriod: number | null;
  activationPeriodDays: number;
  periodActivations: number;
  startsAt: string;
  expiresAt: string;
  autoRenew: boolean;
  sponsored: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  RETAIL_PAID: "Paid plan",
  LEGACY_PLAN: "Previous plan (honoured until expiry)",
  ENTERPRISE_PLAN: "Bulk plan",
  ENTERPRISE_CONTRACT: "Enterprise contract",
  STRATEGIC_INDIVIDUAL: "Strategic trial (invitation)",
  FOUNDING_COMMERCIAL_PARTNER: "Founding Commercial Partner",
  FOUNDING_ORGANISATION: "Founding Organisation",
  SPONSORED_ORGANISATION_MEMBER: "Sponsored by an organisation",
  ADMIN_GRANT: "VerifyMzansi grant",
};

const AREA_LABELS: Record<string, string> = {
  MZANSI_MARKET: "Mzansi Market",
  MZANSI_BUSINESS: "Mzansi Business",
  PROMOTIONS_EVENTS: "Tourism",
};

const date = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

export function parseSlotUsage(raw: unknown): SlotUsageEntry[] {
  return Array.isArray(raw) ? (raw as SlotUsageEntry[]) : [];
}

/** Active posting slots: capacity, usage, activations and expiry per plan. */
export function SlotUsageCard({ entries }: { entries: SlotUsageEntry[] }) {
  const current = entries.filter((entry) => entry.status === "active");
  const ended = entries.filter((entry) => entry.status !== "active").slice(0, 3);

  if (current.length === 0 && ended.length === 0) return null;

  return (
    <Card data-testid="slot-usage-card">
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers aria-hidden="true" className="h-5 w-5 text-brand-green" />
            <h2 className="font-display text-base font-semibold">Posting slots</h2>
          </div>
          <Button asChild variant="outline" size="sm" className="h-11 rounded-full">
            <Link href="/billing">Add a slot</Link>
          </Button>
        </div>

        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active plan. Your posts are saved — reactivate them from R50 / 30 days.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {current.map((entry) => {
              const pct = entry.slotCapacity
                ? Math.min(100, Math.round((entry.activeUsage / entry.slotCapacity) * 100))
                : 0;
              const activationLimit =
                entry.activationLimitTotal ?? entry.activationLimitPerPeriod ?? null;
              const activationsUsed =
                entry.activationLimitTotal !== null
                  ? entry.activationCount
                  : entry.periodActivations;
              return (
                <li key={entry.id} className="rounded-xl border border-border/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      {entry.planName ?? SOURCE_LABELS[entry.source] ?? "Plan"}
                    </p>
                    {entry.sponsored ? <Badge variant="secondary">Sponsored</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {SOURCE_LABELS[entry.source] ?? entry.source} ·{" "}
                    {entry.area ? AREA_LABELS[entry.area] : "All sections"}
                  </p>
                  <div className="mt-2 flex items-baseline justify-between text-sm">
                    <span>
                      <strong>{entry.activeUsage}</strong> of {entry.slotCapacity} slot
                      {entry.slotCapacity === 1 ? "" : "s"} in use
                    </span>
                    <span className="text-xs text-muted-foreground">
                      until {date.format(new Date(entry.expiresAt))}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={entry.slotCapacity}
                    aria-valuenow={entry.activeUsage}
                    aria-label="Slots in use"
                  >
                    <div
                      className="h-full rounded-full bg-brand-green"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {activationLimit !== null ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {activationsUsed} of {activationLimit} activations used
                      {entry.activationLimitTotal === null
                        ? ` in the last ${entry.activationPeriodDays} days`
                        : " for this programme"}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.autoRenew ? "Renews automatically" : "Does not renew automatically"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {ended.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Recently ended:{" "}
            {ended
              .map(
                (entry) =>
                  `${entry.planName ?? SOURCE_LABELS[entry.source] ?? "Plan"} (${date.format(new Date(entry.expiresAt))})`
              )
              .join(", ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

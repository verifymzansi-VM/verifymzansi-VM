import { Card, CardContent } from "@/components/ui/card";

/**
 * Admin cost panel (DEC-29). Renders the DTO of `api.staff_cost_overview` from
 * the new backend: every cost line against its free allowance, the activity
 * behind it, the largest storage accounts and open alarms. BF-16 wires the
 * admin route to that command; this component only formats the data.
 */

export type CostLevel =
  | "ok"
  | "warning"
  | "critical"
  | "check_provider"
  | "no_free_allowance"
  | "allowance_unknown"
  | "unverified_allowance"
  | "estimated_usage";

export interface CostLine {
  metric: string;
  label: string;
  unit: "bytes" | "count";
  provider: string;
  period: "current" | "month" | "day";
  measurement?: "database_observation" | "estimate" | "provider_required";
  billing_scope?: "unverified" | "account" | "organization" | "project" | "contract";
  source_url?: string | null;
  used: string | null;
  free_quantity: string | null;
  percent_of_free: number | null;
  level: CostLevel;
  overage_note: string;
  verified_on: string | null;
}

export interface CostOverview {
  generated_at: string;
  lines: CostLine[];
  drivers: {
    accounts: number;
    new_accounts_this_month: number;
    live_posts: number;
    uploads_last_30_days: number;
    average_bytes_per_live_post: string;
    unused_media_bytes_awaiting_cleanup: string;
    expired_posts_awaiting_deletion: number;
    evidence_files: number;
    posts_by_status: Record<string, number>;
  };
  largest_storage_accounts: Array<{
    account_id: string;
    bytes: string | number;
    live_posts: number;
    package_posts: number;
  }>;
  open_alarms: Array<{
    id: string;
    metric: string;
    level: "warning" | "critical";
    period: string;
    raised_at: string;
  }>;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 1536 → "1.5 KB"; counts use thousands separators. */
export function formatQuantity(value: string | number | null, unit: "bytes" | "count"): string {
  if (value === null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (unit === "count") return n.toLocaleString("en-ZA");
  let size = n;
  let i = 0;
  while (size >= 1000 && i < UNITS.length - 1) {
    size /= 1000;
    i += 1;
  }
  return `${i === 0 ? size : size.toFixed(1)} ${UNITS[i]}`;
}

const LEVEL_TEXT: Record<CostLevel, string> = {
  ok: "Within free allowance",
  warning: "Over 70% of free allowance",
  critical: "Over 90% of free allowance",
  check_provider: "Check the provider dashboard",
  no_free_allowance: "Allowance unknown",
  allowance_unknown: "Allowance unknown",
  unverified_allowance: "Free allowance not verified",
  estimated_usage: "Estimated use — check provider",
};

const LEVEL_CLASS: Record<CostLevel, string> = {
  ok: "bg-muted text-muted-foreground",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  critical: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  check_provider: "bg-muted text-muted-foreground",
  no_free_allowance: "bg-muted text-muted-foreground",
  allowance_unknown: "bg-muted text-muted-foreground",
  unverified_allowance: "bg-muted text-muted-foreground",
  estimated_usage: "bg-muted text-muted-foreground",
};

function checkedLevel(line: CostLine): CostLevel {
  if (line.used === null || line.measurement === "provider_required") return "check_provider";
  if (line.free_quantity === null) return "allowance_unknown";
  if (!line.verified_on || !line.billing_scope || line.billing_scope === "unverified")
    return "unverified_allowance";
  if (line.measurement !== "database_observation") return "estimated_usage";
  return line.level;
}

export function CostOverviewPanel({ overview }: { overview: CostOverview }) {
  const { drivers } = overview;
  return (
    <div className="space-y-6">
      {overview.open_alarms.length > 0 && (
        <div role="alert" className="rounded-2xl border border-red-300 p-4 text-sm">
          {overview.open_alarms.length} cost alarm{overview.open_alarms.length === 1 ? "" : "s"}{" "}
          need attention:{" "}
          {overview.open_alarms.map((alarm) => `${alarm.metric} (${alarm.level})`).join(", ")}
        </div>
      )}

      <section aria-labelledby="cost-lines-title" className="space-y-3">
        <h2 id="cost-lines-title" className="font-display text-lg font-bold">
          What can increase our bill
        </h2>
        <p className="text-sm text-muted-foreground">
          Database observations and estimates. Check provider account usage before treating these
          figures as a bill or available budget.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {overview.lines.map((line) => {
            const level = checkedLevel(line);
            const showPercent =
              ["ok", "warning", "critical"].includes(level) && line.percent_of_free !== null;
            return (
              <Card key={line.metric}>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{line.label}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${LEVEL_CLASS[level]}`}>
                      {LEVEL_TEXT[level]}
                    </span>
                  </div>
                  <p className="font-display text-2xl font-bold">
                    {formatQuantity(line.used, line.unit)}
                    {line.free_quantity && (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        of {formatQuantity(line.free_quantity, line.unit)}{" "}
                        {line.verified_on ? "listed allowance" : "unverified listed allowance"}
                        {line.period === "month" ? " this month" : ""}
                        {line.period === "day" ? " today" : ""}
                      </span>
                    )}
                  </p>
                  {showPercent && line.percent_of_free !== null && (
                    <div
                      role="meter"
                      aria-label={`${line.label} used`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, line.percent_of_free)}
                      className="h-2 rounded-full bg-muted"
                    >
                      <div
                        className="h-2 rounded-full bg-foreground/70"
                        style={{ width: `${Math.min(100, line.percent_of_free)}%` }}
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {line.provider}: {line.overage_note}
                    {line.verified_on
                      ? ` (checked ${line.verified_on})`
                      : " (price not yet checked)"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="cost-drivers-title" className="space-y-3">
        <h2 id="cost-drivers-title" className="font-display text-lg font-bold">
          What drives it
        </h2>
        <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          {[
            ["Accounts", formatQuantity(drivers.accounts, "count")],
            ["New accounts this month", formatQuantity(drivers.new_accounts_this_month, "count")],
            ["Live posts", formatQuantity(drivers.live_posts, "count")],
            ["Uploads in 30 days", formatQuantity(drivers.uploads_last_30_days, "count")],
            [
              "Average media per live post",
              formatQuantity(drivers.average_bytes_per_live_post, "bytes"),
            ],
            [
              "Unused media awaiting cleanup",
              formatQuantity(drivers.unused_media_bytes_awaiting_cleanup, "bytes"),
            ],
            [
              "Ended posts awaiting deletion",
              formatQuantity(drivers.expired_posts_awaiting_deletion, "count"),
            ],
            ["ID and business documents", formatQuantity(drivers.evidence_files, "count")],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-border p-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-display text-lg font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {overview.largest_storage_accounts.length > 0 && (
        <section aria-labelledby="cost-accounts-title" className="space-y-3">
          <h2 id="cost-accounts-title" className="font-display text-lg font-bold">
            Largest storage users
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-2">
                  Account
                </th>
                <th scope="col">Storage</th>
                <th scope="col">Live posts</th>
                <th scope="col">Package posts</th>
              </tr>
            </thead>
            <tbody>
              {overview.largest_storage_accounts.map((account) => (
                <tr key={account.account_id} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{account.account_id.slice(0, 8)}</td>
                  <td>{formatQuantity(account.bytes, "bytes")}</td>
                  <td>{account.live_posts}</td>
                  <td>{account.package_posts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

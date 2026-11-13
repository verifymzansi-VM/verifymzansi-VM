import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";
import { createLogger } from "@/lib/utils/logger";
import { formatSaLongDate } from "@/lib/utils/format";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock } from "lucide-react";
import { LiftRestrictionButton } from "./lift-restriction-button";
import { redirect } from "next/navigation";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFrontendEnforcement } from "@/lib/foundation/enforcement";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

export const metadata = {
  title: "Restrictions — Governance",
  description: "Active suspensions and bans, and recent enforcement actions.",
};

const PAGE_SIZE = 50;

export default async function GovernanceEnforcementPage() {
  const { user } = await requireStaff("enforcement:execute");
  let data;
  try {
    const { api } = await readFoundationServerSession();
    data = await readFrontendEnforcement(api, user.id);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", "/admin/governance/enforcement"));
    createLogger("GovernanceEnforcement").error("Enforcement read failed");
    return (
      <p role="alert">
        Enforcement could not be loaded. Refresh to try again. This does not mean nobody is
        restricted.
      </p>
    );
  }
  const restrictions = data.items;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Restrictions"
        description="Active suspensions and bans. Lifting one restores only the content it hid, once nothing else restricts the account."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Restrictions" }]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active suspensions</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.suspensions ?? "Unavailable"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active bans</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.bans ?? "Unavailable"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emergency containments</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.emergency}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active restrictions</CardTitle>
        </CardHeader>
        <CardContent>
          {restrictions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No account is suspended or banned.
            </p>
          ) : (
            <ul className="space-y-2">
              {restrictions.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">
                      {r.display_name || `${r.account_id.slice(0, 8)}…`}{" "}
                      <Badge variant={r.kind === "ban" ? "destructive" : "secondary"}>
                        {r.kind === "ban" ? "Banned" : "Suspended"}
                      </Badge>{" "}
                      {r.emergency && <Badge variant="outline">Emergency, 72 hours</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Since {formatSaLongDate(r.starts_at)}
                      {r.ends_at
                        ? ` · ends ${formatSaLongDate(r.ends_at)}`
                        : " · until lifted"} ·{" "}
                      <Link
                        href={`/admin/governance/escalations/${r.decision_id}`}
                        className="underline"
                      >
                        Decision
                      </Link>
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{r.reason}</p>
                  </div>
                  {r.version === null ? (
                    <p className="text-xs text-muted-foreground">
                      This restriction requires review through its decision.
                    </p>
                  ) : r.conflicted ? (
                    <p className="text-xs text-muted-foreground">
                      You took part in this decision, so someone else must lift it.
                    </p>
                  ) : (
                    <LiftRestrictionButton restrictionId={r.id} expectedVersion={r.version} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.total > PAGE_SIZE && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing the latest {PAGE_SIZE} of {data.total}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent enforcement actions</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.recent.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No recent actions.</p>
          ) : (
            <ul className="space-y-2">
              {data.recent.map((action) => (
                <li
                  key={action.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">{action.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {action.account_id ? `${action.account_id.slice(0, 8)}… · ` : ""}
                      {formatSaLongDate(action.created_at)}
                    </p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{action.reason}</p>
                  </div>
                  <Badge variant={action.action === "ban" ? "destructive" : "secondary"}>
                    {action.action}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

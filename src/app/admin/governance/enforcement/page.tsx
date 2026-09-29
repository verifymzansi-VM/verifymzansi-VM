import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { createLogger } from "@/lib/utils/logger";
import { formatSaLongDate } from "@/lib/utils/format";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock } from "lucide-react";
import { LiftRestrictionButton } from "./lift-restriction-button";

export const metadata = {
  title: "Restrictions — Governance",
  description: "Active suspensions and bans, and recent enforcement actions.",
};

const PAGE_SIZE = 50;

export default async function GovernanceEnforcementPage() {
  const { user } = await requireStaff("enforcement:execute");
  const admin = createAdminClient();

  const [restrictionsResult, suspensions, bans, recentResult] = await Promise.all([
    admin
      .from("account_restrictions")
      .select(
        "id, decision_id, user_id, kind, reason, starts_at, ends_at, emergency, decision_records!account_restrictions_decision_id_fkey(recommender_id, approver_id)",
        { count: "exact" }
      )
      .is("lifted_at", null)
      .in("kind", ["suspension", "ban"])
      .order("starts_at", { ascending: false })
      .limit(PAGE_SIZE),
    admin
      .from("account_restrictions")
      .select("id", { count: "exact", head: true })
      .is("lifted_at", null)
      .eq("kind", "suspension"),
    admin
      .from("account_restrictions")
      .select("id", { count: "exact", head: true })
      .is("lifted_at", null)
      .eq("kind", "ban"),
    admin
      .from("moderation_actions")
      .select("id, action, target_owner_id, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (restrictionsResult.error) {
    createLogger("GovernanceEnforcement").error("Enforcement read failed", {
      error: restrictionsResult.error.message,
    });
    return (
      <p role="alert">
        Enforcement could not be loaded. Refresh to try again. This does not mean nobody is
        restricted.
      </p>
    );
  }

  const restrictions = restrictionsResult.data ?? [];
  const userIds = [...new Set(restrictions.map((r) => r.user_id))];
  const { data: profiles } = userIds.length
    ? await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("user_id, display_name")
        .in("user_id", userIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const nameById = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name] as const));

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
            <div className="text-2xl font-bold">{suspensions.count ?? "Unavailable"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active bans</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bans.count ?? "Unavailable"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emergency containments</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {restrictions.filter((r) => r.emergency).length}
            </div>
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
              {restrictions.map((r) => {
                const decision = Array.isArray(r.decision_records)
                  ? r.decision_records[0]
                  : r.decision_records;
                const tookPart =
                  decision?.recommender_id === user.id || decision?.approver_id === user.id;
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">
                        {nameById.get(r.user_id) || `${r.user_id.slice(0, 8)}…`}{" "}
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
                    {tookPart ? (
                      <p className="text-xs text-muted-foreground">
                        You took part in this decision, so someone else must lift it.
                      </p>
                    ) : (
                      <LiftRestrictionButton restrictionId={r.id} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {(restrictionsResult.count ?? 0) > PAGE_SIZE && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing the latest {PAGE_SIZE} of {restrictionsResult.count}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent enforcement actions</CardTitle>
        </CardHeader>
        <CardContent>
          {!recentResult.data?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No recent actions.</p>
          ) : (
            <ul className="space-y-2">
              {recentResult.data.map((action) => (
                <li
                  key={action.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">{action.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {action.target_owner_id ? `${action.target_owner_id.slice(0, 8)}… · ` : ""}
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

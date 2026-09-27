import { BrandShield as Shield } from "@/components/shared/brand-shield";
import { requireStaff } from "@/lib/auth/require-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { formatSaLongDate } from "@/lib/utils/format";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserPlus, UserMinus, Clock, Hourglass } from "lucide-react";
import { RoleAssignForm } from "@/components/admin/role-assign-form";
import { RoleChangeReviewActions } from "@/components/admin/role-change-review-actions";
import type { StaffRole } from "@/types/enums";

export const metadata = {
  title: "Role Management — Governance",
  description: "Manage staff role assignments with independent approval and a full audit trail.",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  governance_controller: "Governor",
  moderator: "Moderator",
  member: "Member",
};

const RANK: Record<string, number> = { member: 0, moderator: 1, governance_controller: 2, admin: 3 };

/** Mirrors role_change_approver_allowed() in SQL; the database has the final say. */
function canReview(reviewerRole: StaffRole, from: string, to: string): boolean {
  if (to === "moderator" && RANK[to] > RANK[from]) {
    return reviewerRole === "admin" || reviewerRole === "governance_controller";
  }
  return reviewerRole === "admin";
}

interface Person {
  name: string;
  email: string | null;
}

export default async function GovernanceRolesPage() {
  const { user, role } = await requireStaff("role:review");
  const canAssign = roleHasCapability(role, "role:assign");
  const admin = createAdminClient();

  const [staffResult, pendingResult, historyResult] = await Promise.all([
    admin
      .from("staff_roles")
      .select("user_id, role, granted_at, mfa_required_after")
      .eq("status", "active")
      .order("granted_at", { ascending: false })
      .limit(500),
    admin
      .from("decision_records")
      .select("id, payload, payload_version, recommender_id, rationale, created_at, expires_at")
      .eq("case_type", "staff_role")
      .eq("status", "pending_approval")
      .order("created_at", { ascending: true })
      .limit(100),
    admin
      .from("role_assignments_history")
      .select("id, target_user_id, previous_role, new_role, assigned_by, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  if (staffResult.error || pendingResult.error || historyResult.error) {
    createLogger("GovernanceRolesPage").error("Role management read failed", {
      error: (staffResult.error ?? pendingResult.error ?? historyResult.error)?.message,
    });
    return (
      <p role="alert">
        Role management could not be loaded. Refresh to try again. This does not mean there are no
        staff.
      </p>
    );
  }

  const staff = staffResult.data ?? [];
  const pending = (pendingResult.data ?? []).map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      ...row,
      targetId: String(payload.target_user_id ?? ""),
      from: String(payload.from_role ?? "member"),
      to: String(payload.to_role ?? ""),
    };
  });
  const history = historyResult.data ?? [];

  // Names for everyone shown on the page, in one profile query plus one Auth
  // lookup per person (staff lists are small).
  const ids = [
    ...new Set([
      ...staff.map((s) => s.user_id),
      ...pending.flatMap((p) => [p.targetId, p.recommender_id]),
      ...history.flatMap((h) => [h.target_user_id, h.assigned_by]),
    ]),
  ].filter(Boolean);
  const [{ data: profiles }, authUsers] = await Promise.all([
    admin.from(ACCOUNT_PROFILE_WRITE_TABLE).select("user_id, display_name").in("user_id", ids),
    Promise.all(ids.map((id) => admin.auth.admin.getUserById(id))),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name] as const));
  const people = new Map<string, Person>(
    ids.map((id, i) => {
      const email = authUsers[i]?.data?.user?.email ?? null;
      return [id, { name: nameById.get(id) || email || `${id.slice(0, 8)}…`, email }];
    })
  );
  const person = (id: string): Person => people.get(id) ?? { name: `${id.slice(0, 8)}…`, email: null };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Management"
        description="Promotions need an independent approver. Removals by an admin take effect immediately."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Role Management" }]}
      />

      <RoleAssignForm mode={canAssign ? "admin" : "governor"} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hourglass className="h-5 w-5" />
            Waiting for approval
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No role changes are waiting.</p>
          ) : (
            <ul className="space-y-3">
              {pending.map((p) => {
                const target = person(p.targetId);
                const proposer = person(p.recommender_id);
                const isOwn = p.recommender_id === user.id;
                const isAboutMe = p.targetId === user.id;
                return (
                  <li key={p.id} className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm">
                      <span className="font-medium">{target.name}</span>{" "}
                      <Badge variant="outline">{ROLE_LABELS[p.from] ?? p.from}</Badge>
                      {" → "}
                      <Badge variant="outline">{ROLE_LABELS[p.to] ?? p.to}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Proposed by {proposer.name} on {formatSaLongDate(p.created_at)}
                      {p.expires_at && ` · expires ${formatSaLongDate(p.expires_at)}`}
                    </p>
                    <p className="text-sm">{p.rationale}</p>
                    <RoleChangeReviewActions
                      decisionId={p.id}
                      payloadVersion={p.payload_version}
                      canApprove={!isOwn && !isAboutMe && canReview(role, p.from, p.to)}
                      canWithdraw={isOwn}
                      blockedReason={
                        isAboutMe
                          ? "This change is about you, so someone else must review it."
                          : isOwn
                            ? "Waiting for someone else to approve your proposal."
                            : !canReview(role, p.from, p.to)
                              ? "An admin must review this change."
                              : null
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Current staff
          </CardTitle>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff found.</p>
          ) : (
            <ul className="space-y-3">
              {staff.map((s) => {
                const who = person(s.user_id);
                return (
                  <li
                    key={s.user_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{who.name}</p>
                      {who.email && who.email !== who.name && (
                        <p className="truncate text-sm text-muted-foreground">{who.email}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Since {formatSaLongDate(s.granted_at)}
                      </p>
                    </div>
                    <Badge variant={s.role === "admin" ? "default" : "outline"}>
                      {ROLE_LABELS[s.role] ?? s.role}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Role change history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No role changes recorded.</p>
          ) : (
            <ul className="space-y-3">
              {history.map((entry) => {
                const removed = entry.new_role === "member";
                return (
                  <li key={entry.id} className="flex items-start gap-3 rounded-lg border p-3">
                    {removed ? (
                      <UserMinus className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                    ) : (
                      <UserPlus className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{person(entry.target_user_id).name}</span>{" "}
                        <Badge variant="outline" className="text-xs">
                          {ROLE_LABELS[entry.previous_role ?? "member"] ?? entry.previous_role}
                        </Badge>
                        {" → "}
                        <Badge variant="outline" className="text-xs">
                          {ROLE_LABELS[entry.new_role] ?? entry.new_role}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        By {person(entry.assigned_by).name}
                        {entry.reason ? ` — ${entry.reason}` : ""}
                      </p>
                    </div>
                    <time className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatSaLongDate(entry.created_at)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability, isAdmin } from "@/lib/auth/roles";
import { ACCOUNT_PROFILE_WRITE_TABLE, normalizeUserRole } from "@/lib/account/compat";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, UserPlus, UserMinus, Clock } from "lucide-react";
import { RoleAssignForm } from "@/components/admin/role-assign-form";

export const metadata = {
  title: "Role Management — Governance",
  description: "Manage staff role assignments with full audit trail.",
};

function readMetadataString(
  metadata: unknown,
  key: "role" | "display_name" | "full_name"
): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

export default async function GovernanceRolesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "audit:view")) {
    redirect("/admin");
  }

  const userIsAdmin = isAdmin(user);

  const admin = createAdminClient();

  // Recent role assignment history
  const { data: roleHistory } = await admin
    .from("role_assignments_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);

  // Current staff users are sourced from auth app_metadata.role, then enriched with profile names.
  const authUsers: Array<{
    id: string;
    email?: string | null;
    updated_at?: string | null;
    app_metadata?: unknown;
    user_metadata?: unknown;
  }> = [];

  const perPage = 200;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message || "Failed to load staff roster");
    }

    const users = data?.users ?? [];
    authUsers.push(
      ...users.filter((authUser) => {
        const role = normalizeUserRole(readMetadataString(authUser.app_metadata, "role"));
        return role === "moderator" || role === "governance_controller" || role === "admin";
      })
    );

    if (users.length < perPage) {
      break;
    }
  }

  const staffIds = authUsers.map((authUser) => authUser.id);
  const { data: staffProfiles } = staffIds.length
    ? await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("user_id, display_name")
        .in("user_id", staffIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };

  const displayNameByUserId = new Map(
    (staffProfiles ?? []).map((profile) => [profile.user_id, profile.display_name] as const)
  );

  const staffUsers = authUsers
    .map((authUser) => {
      const role = normalizeUserRole(readMetadataString(authUser.app_metadata, "role"));
      if (role !== "moderator" && role !== "governance_controller" && role !== "admin") {
        return null;
      }

      return {
        id: authUser.id,
        display_name:
          displayNameByUserId.get(authUser.id) ??
          readMetadataString(authUser.user_metadata, "display_name") ??
          readMetadataString(authUser.user_metadata, "full_name") ??
          null,
        email: authUser.email ?? null,
        role,
        updated_at: authUser.updated_at ?? null,
      };
    })
    .filter((staffUser): staffUser is NonNullable<typeof staffUser> => Boolean(staffUser))
    .sort((left, right) => {
      const leftTime = left.updated_at ? new Date(left.updated_at).getTime() : 0;
      const rightTime = right.updated_at ? new Date(right.updated_at).getTime() : 0;
      return rightTime - leftTime;
    });

  const roleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin":
        return "default" as const;
      case "governance_controller":
        return "secondary" as const;
      case "moderator":
        return "outline" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Management"
        description="View and audit staff role assignments."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Role Management" }]}
      />

      {/* Admin-only: role assignment form */}
      {userIsAdmin && <RoleAssignForm />}

      {/* Current staff roster */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Current Staff Roster
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!staffUsers?.length ? (
            <p className="text-sm text-muted-foreground">No staff users found.</p>
          ) : (
            <div className="space-y-3">
              {staffUsers.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium">{u.display_name || "Unnamed"}</p>
                    <p className="text-sm text-muted-foreground">{u.email || u.id}</p>
                  </div>
                  <Badge variant={roleBadgeVariant(u.role)}>{u.role}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Role Change History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Role Change History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!roleHistory?.length ? (
            <p className="text-sm text-muted-foreground">No role changes recorded.</p>
          ) : (
            <div className="space-y-3">
              {roleHistory.map((entry: Record<string, unknown>) => (
                <div
                  key={entry.id as string}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  {entry.new_role ? (
                    <UserPlus className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <UserMinus className="h-4 w-4 text-red-600 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">
                        {(entry.target_user_id as string)?.slice(0, 8)}…
                      </span>{" "}
                      <Badge variant="outline" className="text-xs">
                        {entry.previous_role as string}
                      </Badge>
                      {" → "}
                      <Badge variant="outline" className="text-xs">
                        {entry.new_role as string}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Changed by {(entry.assigned_by as string)?.slice(0, 8)}…
                      {entry.reason ? ` — ${entry.reason as string}` : ""}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(entry.created_at as string).toLocaleDateString("en-ZA", {
                      timeZone: "Africa/Johannesburg",
                    })}
                  </time>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

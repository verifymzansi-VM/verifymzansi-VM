import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminLiveNotifier } from "@/components/admin/admin-live-notifier";
import { AdminRealtimeRefresh } from "@/components/admin/admin-realtime-refresh";
import { NotificationBell } from "@/components/notification-bell";
import { BrandLogo } from "@/components/shared/brand-logo";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRoleFromUser, isStaff, asStaffRole } from "@/lib/auth/roles";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { getPendingModerationCount } from "@/lib/utils/admin-queries";

/** Prevent search engines from indexing admin pages */
export const metadata = {
  robots: { index: false, follow: false },
};

const WORKSPACE_LABELS: Record<string, string> = {
  moderator: "Operations",
  governance_controller: "Governance",
  admin: "Intelligence",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Default to unprivileged role — never grant staff access implicitly.
  // The middleware enforces admin access, but defense-in-depth ensures
  // non-staff authenticated users are never shown the admin UI.
  if (!user || !isStaff(user)) {
    const { redirect } = await import("next/navigation");
    redirect(!user ? "/login" : "/dashboard");
  }
  const staffUser = user!;
  const role = getRoleFromUser(staffUser) || "viewer";
  const staffRole = asStaffRole(role);
  const workspaceLabel = staffRole ? (WORKSPACE_LABELS[staffRole] ?? "Admin") : "Admin";

  // Fetch counts for sidebar badges (using admin client for cross-user data)
  const admin = createAdminClient();
  const [
    { count: pendingVerifications },
    { count: openReports },
    pendingModeration,
    evidenceDeskEnabled,
  ] = await Promise.all([
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    admin.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
    getPendingModerationCount(),
    isFeatureEnabled("kyc_evidence_desk"),
  ]);

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      {/* Admin specific minimalist top-nav instead of public Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <span className="rounded-full border border-border px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {workspaceLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell userId={staffUser.id} />
          </div>
        </div>
      </header>

      <AdminLiveNotifier userId={staffUser.id} />
      <AdminRealtimeRefresh />

      <div className="flex min-w-0 flex-1 overflow-x-hidden">
        <AdminSidebar
          pendingVerifications={pendingVerifications || 0}
          openReports={openReports || 0}
          pendingModeration={pendingModeration}
          userRole={role}
          evidenceDeskEnabled={evidenceDeskEnabled}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="min-w-0 max-w-full px-3 py-4 sm:px-4 sm:py-6 lg:px-5">{children}</div>
        </main>
      </div>
    </div>
  );
}

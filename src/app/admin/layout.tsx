import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminLiveNotifier } from "@/components/admin/admin-live-notifier";
import { AdminRealtimeRefresh } from "@/components/admin/admin-realtime-refresh";
import { NotificationBell } from "@/components/notification-bell";
import { BrandLogo } from "@/components/shared/brand-logo";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/auth/require-staff";
import { STAFF_MFA_PATH } from "@/lib/auth/staff-mfa";
import { formatSaLongDate } from "@/lib/utils/format";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { getPendingModerationCount } from "@/lib/utils/admin-queries";

/** Prevent search engines from indexing admin pages */
export const metadata = {
  robots: { index: false, follow: false },
};

const WORKSPACE_LABELS: Record<string, string> = {
  moderator: "Operations",
  governance_controller: "Governance",
  admin: "Admin",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Staff role, account status and two-step verification come from the
  // database on every request; the JWT role is never trusted.
  const staff = await requireStaff();
  const staffUser = staff.user;
  const role = staff.role;
  const workspaceLabel = WORKSPACE_LABELS[role] ?? "Admin";

  // Fetch counts for sidebar badges (using admin client for cross-user data)
  const admin = createAdminClient();
  const [
    { count: pendingVerifications },
    { count: openReports },
    { count: newSupportRequests },
    pendingModeration,
    evidenceDeskEnabled,
  ] = await Promise.all([
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    admin.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin
      .from("contact_submissions")
      .select("*", { count: "exact", head: true })
      .eq("status", "new"),
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

      {staff.mfa.status === "grace" && (
        <div role="status" className="border-b bg-muted px-4 py-2 text-center text-sm">
          Set up two-step verification by {formatSaLongDate(staff.mfa.graceEndsAt)} to keep
          access.{" "}
          <Link href={STAFF_MFA_PATH} className="font-medium underline">
            Set it up now
          </Link>
        </div>
      )}

      <AdminLiveNotifier userId={staffUser.id} userRole={role} />
      <AdminRealtimeRefresh />

      <div className="flex min-w-0 w-full flex-1 overflow-x-hidden">
        <AdminSidebar
          pendingVerifications={pendingVerifications || 0}
          openReports={openReports || 0}
          pendingModeration={pendingModeration}
          newSupportRequests={newSupportRequests || 0}
          userRole={role}
          evidenceDeskEnabled={evidenceDeskEnabled}
        />
        <main id="main-content" className="min-w-0 w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="min-w-0 w-full max-w-full px-3 py-4 sm:px-4 sm:py-6 lg:px-5">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

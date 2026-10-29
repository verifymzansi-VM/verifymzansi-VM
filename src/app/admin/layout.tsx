import Link from "next/link";
import { AdminMobileNav, AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminLiveNotifier } from "@/components/admin/admin-live-notifier";
import { AdminRealtimeRefresh } from "@/components/admin/admin-realtime-refresh";
import { NotificationBell } from "@/components/notification-bell";
import { BrandLogo } from "@/components/shared/brand-logo";
import { requireStaff } from "@/lib/auth/require-staff";
import { STAFF_MFA_PATH } from "@/lib/auth/staff-mfa";
import { navFor } from "@/lib/admin/nav";
import { getStaffNavCounts } from "@/lib/services/staff-dashboard";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { formatSaLongDate } from "@/lib/utils/format";

/** Prevent search engines from indexing admin pages */
export const metadata = {
  robots: { index: false, follow: false },
};

const ROLE_LABELS = {
  moderator: "Moderator",
  governance_controller: "Governor",
  admin: "Admin",
} as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Staff role, account status and two-step verification come from the
  // database on every request; the JWT role is never trusted.
  const staff = await requireStaff();
  const [counts, evidenceDeskEnabled] = await Promise.all([
    getStaffNavCounts(staff.user.id),
    isFeatureEnabled("kyc_evidence_desk"),
  ]);
  const sections = navFor(staff.role, { kyc_evidence_desk: evidenceDeskEnabled });

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-slate-50 dark:bg-slate-950">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <AdminMobileNav sections={sections} counts={counts} />
            <Link href="/admin" aria-label="Admin home" className="shrink-0">
              <BrandLogo size="sm" />
            </Link>
            <span className="rounded-full border border-border px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {ROLE_LABELS[staff.role]}
            </span>
          </div>
          <NotificationBell userId={staff.user.id} />
        </div>
      </header>

      {staff.mfa.status === "grace" && (
        <div role="status" className="border-b bg-muted px-4 py-2 text-center text-sm">
          Set up two-step verification by {formatSaLongDate(staff.mfa.graceEndsAt)} to keep access.{" "}
          <Link href={STAFF_MFA_PATH} className="font-medium underline">
            Set it up now
          </Link>
        </div>
      )}

      <AdminLiveNotifier userId={staff.user.id} userRole={staff.role} />
      <AdminRealtimeRefresh userId={staff.user.id} />

      <div className="flex w-full min-w-0 flex-1 overflow-x-hidden">
        <AdminSidebar sections={sections} counts={counts} />
        <main id="main-content" className="w-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="w-full min-w-0 max-w-full px-4 py-4 sm:py-6 lg:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

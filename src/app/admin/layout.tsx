import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRoleFromUser } from "@/lib/auth/roles";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Default to unprivileged role — never grant moderator/admin implicitly.
  // The middleware (proxy.ts) enforces admin access, but defense-in-depth
  // ensures unauthenticated users are never treated as moderators.
  if (!user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  const role = getRoleFromUser(user) || "viewer";

  // Fetch counts for sidebar badges (using admin client for cross-user data)
  const admin = createAdminClient();
  const [
    { count: pendingVerifications },
    { count: openReports },
    { count: pendingModeration },
    evidenceDeskEnabled,
  ] = await Promise.all([
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    admin.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
    isFeatureEnabled("kyc_evidence_desk"),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      {/* Admin specific minimalist top-nav instead of public Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <span className="font-bold tracking-tight">VerifyMzansi Admin</span>
        </div>
      </header>

      <div className="flex flex-1">
        <AdminSidebar
          pendingVerifications={pendingVerifications || 0}
          openReports={openReports || 0}
          pendingModeration={pendingModeration || 0}
          userRole={role}
          evidenceDeskEnabled={evidenceDeskEnabled}
        />
        <main className="flex-1 overflow-auto">
          <div className="container-page py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

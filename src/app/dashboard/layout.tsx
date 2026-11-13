"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { summarizeVerification } from "@/lib/account/verification-summary";
import {
  DashboardSidebar,
  type DashboardSidebarBadges,
} from "@/components/dashboard/dashboard-sidebar";
import { DashboardMobileNav } from "@/components/dashboard/dashboard-mobile-nav";
import { createClient } from "@/lib/supabase/client";
import { useLeadsUnread } from "@/hooks/use-leads-unread";
import { signOutBrowserSession } from "@/hooks/use-auth";
import { dashboardVerificationSteps, parseOwnerDashboard } from "@/lib/foundation/owner-dashboard";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [badges, setBadges] = useState<DashboardSidebarBadges>({});
  const { unreadCount: unreadLeads } = useLeadsUnread();
  const sidebarBadges = useMemo(
    () => ({
      ...badges,
      unreadLeads,
    }),
    [badges, unreadLeads]
  );

  // Fetch sidebar badge counts client-side (lightweight)
  useEffect(() => {
    async function fetchBadges() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const response = await fetch("/api/foundation/dashboard", { cache: "no-store" });
        if (!response.ok) return;
        const dashboard = parseOwnerDashboard(await response.json(), user.id);
        const verificationSummary = summarizeVerification(
          dashboard.verification.verified ? "verified" : null,
          dashboardVerificationSteps(dashboard)
        );
        setBadges({
          unreadNotifications: dashboard.unread_notifications,
          rejectedListings: dashboard.counts.rejected_listings,
          pendingModeration: dashboard.counts.pending_listings,
          incompleteVerification:
            verificationSummary.accountVerificationStatus === "incomplete" ||
            verificationSummary.accountVerificationStatus === "rejected",
          pendingReview: verificationSummary.accountVerificationStatus === "pending_review",
          verificationProgress: {
            approved: verificationSummary.approvedStepCount,
            submitted: verificationSummary.submittedStepCount,
            total: 4,
          },
        });
      } catch {
        // Non-critical — sidebar works fine without badges
      }
    }

    void fetchBadges();
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOutBrowserSession();
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <DashboardMobileNav badges={sidebarBadges} />

      <div className="flex min-w-0 flex-1">
        <DashboardSidebar badges={sidebarBadges} onSignOut={handleSignOut} />

        <main id="main-content" className="w-0 min-w-0 max-w-full flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

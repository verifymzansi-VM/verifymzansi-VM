"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { ACCOUNT_PROFILE_TABLE, applyOwnerFilter, getOwnerColumn } from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
import {
  DashboardSidebar,
  type DashboardSidebarBadges,
} from "@/components/dashboard/dashboard-sidebar";
import { DashboardMobileNav } from "@/components/dashboard/dashboard-mobile-nav";
import { createClient } from "@/lib/supabase/client";
import { useLeadsUnread } from "@/hooks/use-leads-unread";
import { SuspensionNotice } from "@/components/dashboard/suspension-notice";
import { signOutBrowserSession } from "@/hooks/use-auth";

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

        const [leadOwnerColumn, listingOwnerColumn] = await Promise.all([
          getOwnerColumn(supabase, "leads"),
          getOwnerColumn(supabase, "listings"),
        ]);

        const [
          unreadLeads,
          unreadNotifications,
          rejectedListings,
          pendingModeration,
          verificationSteps,
          accountProfile,
        ] = await Promise.all([
          applyOwnerFilter(
            supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
            leadOwnerColumn,
            user.id
          ),
          supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("read", false),
          applyOwnerFilter(
            supabase
              .from("listings")
              .select("id", { count: "exact", head: true })
              .eq("status", "rejected"),
            listingOwnerColumn,
            user.id
          ),
          applyOwnerFilter(
            supabase
              .from("listings")
              .select("id", { count: "exact", head: true })
              .in("status", ["pending_moderation", "flagged_for_review"]),
            listingOwnerColumn,
            user.id
          ),
          supabase
            .from("verification_steps")
            .select("step_type, status, reviewed_at")
            .eq("user_id", user.id)
            .in("status", ["approved", "pending", "rejected", "needs_resubmission"]),
          supabase
            .from(ACCOUNT_PROFILE_TABLE)
            .select("account_verification_status")
            .eq("user_id", user.id)
            .single(),
        ]);

        const verificationSummary = summarizeVerification(
          accountProfile.data?.account_verification_status,
          verificationSteps.data
        );

        setBadges({
          unreadLeads: unreadLeads.count || 0,
          unreadNotifications: unreadNotifications.count || 0,
          rejectedListings: rejectedListings.count || 0,
          pendingModeration: pendingModeration.count || 0,
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
    <div className="flex min-h-screen flex-col bg-background">
      <Header isAuthenticated />
      <DashboardMobileNav badges={sidebarBadges} />

      <div className="flex min-w-0 flex-1">
        <DashboardSidebar badges={sidebarBadges} onSignOut={handleSignOut} />

        <main id="main-content" className="w-0 min-w-0 max-w-full flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
            <Suspense fallback={null}>
              <SuspensionNotice />
            </Suspense>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

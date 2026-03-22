"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ACCOUNT_PROFILE_TABLE, applyOwnerFilter, getOwnerColumn } from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
import {
  DashboardSidebar,
  type DashboardSidebarBadges,
} from "@/components/dashboard/dashboard-sidebar";
import { createClient } from "@/lib/supabase/client";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [badges, setBadges] = useState<DashboardSidebarBadges>({});

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
            supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "new"),
            leadOwnerColumn,
            user.id
          ),
          supabase
            .from("notifications")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("read", false),
          applyOwnerFilter(
            supabase
              .from("listings")
              .select("*", { count: "exact", head: true })
              .eq("status", "rejected"),
            listingOwnerColumn,
            user.id
          ),
          applyOwnerFilter(
            supabase
              .from("listings")
              .select("*", { count: "exact", head: true })
              .in("status", ["pending_moderation", "flagged_for_review"]),
            listingOwnerColumn,
            user.id
          ),
          supabase
            .from("verification_steps")
            .select("step_type, status")
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
        });
      } catch {
        // Non-critical — sidebar works fine without badges
      }
    }

    fetchBadges();
  }, []);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />

      <div className="flex flex-1">
        <DashboardSidebar badges={badges} onSignOut={handleSignOut} />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <div className="container-page py-6">{children}</div>
        </main>
      </div>

      <MobileNav />
    </div>
  );
}

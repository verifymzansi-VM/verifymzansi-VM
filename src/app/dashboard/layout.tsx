"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
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

        const [unreadLeads, rejectedListings, pendingModeration, verificationSteps] =
          await Promise.all([
            supabase
              .from("leads")
              .select("*", { count: "exact", head: true })
              .eq("seller_id", user.id)
              .eq("status", "new"),
            supabase
              .from("listings")
              .select("*", { count: "exact", head: true })
              .eq("seller_id", user.id)
              .eq("status", "rejected"),
            supabase
              .from("listings")
              .select("*", { count: "exact", head: true })
              .eq("seller_id", user.id)
              .in("status", ["pending_moderation", "flagged_for_review"]),
            supabase
              .from("verification_steps")
              .select("status")
              .eq("user_id", user.id)
              .eq("status", "approved"),
          ]);

        setBadges({
          unreadLeads: unreadLeads.count || 0,
          rejectedListings: rejectedListings.count || 0,
          pendingModeration: pendingModeration.count || 0,
          incompleteVerification: (verificationSteps.data?.length ?? 0) < 4,
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

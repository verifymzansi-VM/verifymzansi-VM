"use client";

import type { ReactNode } from "react";
import { FoundationAccountBoundary } from "@/components/auth/foundation-account-boundary";
import { Header } from "@/components/layout/header";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardMobileNav } from "./dashboard-mobile-nav";
import { signOutBrowserSession } from "@/hooks/use-auth";
import { useFoundationInboxCounts } from "@/hooks/use-foundation-inbox-counts";

export function FoundationDashboardShell({ children }: { children: ReactNode }) {
  const counts = useFoundationInboxCounts();
  const badges = counts
    ? { unreadLeads: counts.unread_enquiries, unreadNotifications: counts.unread_notifications }
    : {};
  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <DashboardMobileNav badges={badges} />
      <div className="flex min-w-0 flex-1">
        <DashboardSidebar
          badges={badges}
          onSignOut={async () => {
            await signOutBrowserSession();
          }}
        />
        <main id="main-content" className="w-0 min-w-0 max-w-full flex-1 overflow-x-hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
            <FoundationAccountBoundary>{children}</FoundationAccountBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}

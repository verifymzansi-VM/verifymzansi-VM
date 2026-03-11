"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KycQueueTable } from "./kyc-queue-table";
import { ContentQueueTable } from "./content-queue-table";
import { FlaggingQueueTable } from "./flagging-queue-table";
import { AreaOverviewStats } from "./area-overview-stats";
import { ActivityFeed } from "./activity-feed";
import { VerificationAlertBanner } from "./verification-alert-banner";
import { FileCheck, Flag, BarChart3, Clock, AlertCircle, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import type { MarketplaceArea } from "@/types/enums";

interface AreaAdminTabsProps {
  area: MarketplaceArea;
  areaLabel: string;
  pendingVerifications: Array<{
    id: string;
    user_id: string;
    step_type: string;
    status: string;
    created_at: string;
    account_display_name?: string | null;
    account_verification_status?: string | null;
    seller_display_name?: string | null;
    seller_verification_status: string | null;
  }>;
  pendingContent: Array<{
    id: string;
    title?: string;
    name?: string;
    business_name?: string;
    store_number?: string;
    mall_name?: string;
    status: string;
    created_at: string;
    category?: string;
    seller_id?: string;
  }>;
  reports: Array<{
    id: string;
    target_id: string;
    target_type: string;
    category: string;
    severity: "high" | "standard";
    status: string;
    description?: string;
    reporter_user_id?: string;
    created_at: string;
  }>;
  activityEntries: Array<{
    id: string;
    actor_id: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  overviewStats: {
    pendingVerificationCount: number;
    pendingFlagCount: number;
    highSeverityOverdue: number;
    pendingContentCount: number;
    actionsToday: Record<string, number>;
  };
}

export function AreaAdminTabs({
  area,
  areaLabel,
  pendingVerifications,
  pendingContent,
  reports,
  activityEntries,
  overviewStats,
}: AreaAdminTabsProps) {
  const router = useRouter();

  function handleRefresh() {
    router.refresh();
  }

  const totalActionsToday = Object.values(overviewStats.actionsToday).reduce((a, b) => a + b, 0);

  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList>
        <TabsTrigger value="overview" className="gap-1.5">
          <BarChart3 className="h-4 w-4" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="verification" className="gap-1.5">
          <FileCheck className="h-4 w-4" />
          Verification
          {(overviewStats.pendingVerificationCount > 0 ||
            overviewStats.pendingContentCount > 0) && (
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
              {overviewStats.pendingVerificationCount + overviewStats.pendingContentCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="flagging" className="gap-1.5">
          <Flag className="h-4 w-4" />
          Flagging
          {overviewStats.pendingFlagCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
              {overviewStats.pendingFlagCount}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      {/* Overview Tab */}
      <TabsContent value="overview" className="space-y-6">
        {overviewStats.pendingVerificationCount > 0 && (
          <VerificationAlertBanner pendingCount={overviewStats.pendingVerificationCount} />
        )}

        <AreaOverviewStats
          stats={[
            {
              icon: FileCheck,
              label: "Pending Verification",
              value: overviewStats.pendingVerificationCount,
            },
            {
              icon: Flag,
              label: "Pending Flags",
              value: overviewStats.pendingFlagCount,
            },
            {
              icon: AlertCircle,
              label: "High Severity Overdue",
              value: overviewStats.highSeverityOverdue,
            },
            {
              icon: Clock,
              label: "Pending Content",
              value: overviewStats.pendingContentCount,
            },
            {
              icon: Shield,
              label: "Actions Today",
              value: totalActionsToday,
            },
          ]}
        />

        {/* Actions Today Breakdown */}
        {totalActionsToday > 0 && (
          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-semibold mb-3">Actions Today Breakdown</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {Object.entries(overviewStats.actionsToday).map(([action, count]) => (
                  <div key={action} className="text-center p-2 rounded-md bg-muted">
                    <p className="text-lg font-bold">{count}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {action.replace(/_/g, " ")}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Activity */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold mb-4">Recent Activity — {areaLabel}</h3>
            <ActivityFeed
              entries={activityEntries}
              emptyMessage={`No recent activity for ${areaLabel}.`}
            />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Verification Tab */}
      <TabsContent value="verification" className="space-y-6">
        {/* KYC Queue — Global (D-021) */}
        <div>
          <h3 className="text-sm font-semibold mb-4">
            Account KYC Queue{" "}
            <span className="text-xs text-muted-foreground font-normal">(Global — all areas)</span>
          </h3>
          <KycQueueTable steps={pendingVerifications} onDecisionComplete={handleRefresh} />
        </div>

        {/* Content Publish Queue — Area-scoped */}
        <div>
          <h3 className="text-sm font-semibold mb-4">
            Content Publish Queue{" "}
            <span className="text-xs text-muted-foreground font-normal">({areaLabel} only)</span>
          </h3>
          <ContentQueueTable
            items={pendingContent}
            area={area}
            onDecisionComplete={handleRefresh}
          />
        </div>
      </TabsContent>

      {/* Flagging Tab */}
      <TabsContent value="flagging">
        <FlaggingQueueTable reports={reports} onActionComplete={handleRefresh} />
      </TabsContent>
    </Tabs>
  );
}

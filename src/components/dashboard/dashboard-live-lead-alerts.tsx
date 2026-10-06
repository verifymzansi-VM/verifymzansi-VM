"use client";

import type { AccountVerificationStatus } from "@/types/enums";
import { useLeadsUnread } from "@/hooks/use-leads-unread";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { StatChips, defaultChips } from "@/components/dashboard/stat-chips";

interface DashboardLiveLeadAlertsProps {
  liveListings: number;
  businesses: number;
  activePromos: number;
  initialUnreadLeadCount: number;
  rejectedListingCount: number;
  pendingModerationCount: number;
  expiringListingCount: number;
  expiringPromoCount: number;
  verificationStatus: AccountVerificationStatus;
  stepsRemaining: number;
  /** Repeat verification reminders in the attention list (off when a verification card is shown). */
  includeVerification?: boolean;
  /** Live businesses that could get the CIPC or Seen sticker. */
  unstickeredBusinessCount?: number;
}

export function DashboardLiveLeadAlerts({
  liveListings,
  businesses,
  activePromos,
  initialUnreadLeadCount,
  rejectedListingCount,
  pendingModerationCount,
  expiringListingCount,
  expiringPromoCount,
  verificationStatus,
  stepsRemaining,
  includeVerification = true,
  unstickeredBusinessCount = 0,
}: DashboardLiveLeadAlertsProps) {
  const { unreadCount, isLoading } = useLeadsUnread();
  const unreadLeadCount = isLoading ? initialUnreadLeadCount : unreadCount;

  const chips = defaultChips({
    liveListings,
    unreadLeads: unreadLeadCount,
    businesses,
    activePromos,
  });

  return (
    <>
      <StatChips chips={chips} />
      <NeedsAttention
        unreadLeadCount={unreadLeadCount}
        rejectedListingCount={rejectedListingCount}
        pendingModerationCount={pendingModerationCount}
        expiringListingCount={expiringListingCount}
        expiringPromoCount={expiringPromoCount}
        verificationStatus={verificationStatus}
        stepsRemaining={stepsRemaining}
        includeVerification={includeVerification}
        unstickeredBusinessCount={unstickeredBusinessCount}
      />
    </>
  );
}

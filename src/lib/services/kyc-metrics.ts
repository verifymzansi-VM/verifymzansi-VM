/**
 * KYC Metrics Service
 *
 * Provides operational metrics for KYC verification monitoring:
 *  - Verification completion rate
 *  - Rejection rate by reason code
 *  - Review SLA (time-to-decision)
 *  - High-risk ratio
 *  - Alert thresholds for anomaly detection
 */

import { createAdminClient } from "@/lib/supabase/admin";

// ── Types ────────────────────────────────────────────────────

export interface KycOverviewMetrics {
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  pendingReview: number;
  averageReviewHours: number | null;
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
}

export interface RejectionBreakdown {
  reasonCode: string;
  count: number;
  percentage: number;
}

// ── Constants ────────────────────────────────────────────────

const _SLA_HOURS = 48; // target: review within 48 hours
const _HIGH_RISK_THRESHOLD_PERCENT = 15; // alert if >15% high/critical
const _REJECTION_SPIKE_THRESHOLD_PERCENT = 40; // alert if >40% rejection rate
const _VELOCITY_WINDOW_HOURS = 1;
const _VELOCITY_MAX_SUBMISSIONS = 50; // alert if >50 submissions per hour

// ── Metrics Functions ────────────────────────────────────────

/**
 * Get overview metrics for the KYC system.
 */
export async function getKycOverviewMetrics(periodDays = 30): Promise<KycOverviewMetrics> {
  const adminClient = createAdminClient();
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

  // Total sessions
  const { count: totalSessions } = await adminClient
    .from("verification_sessions")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since);

  // Completed sessions
  const { count: completedSessions } = await adminClient
    .from("verification_sessions")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed")
    .gte("created_at", since);

  // Pending review steps
  const { count: pendingReview } = await adminClient
    .from("verification_steps")
    .select("*", { count: "exact", head: true })
    .eq("auto_status", "needs_manual_review")
    .is("status", null)
    .gte("submitted_at", since);

  // Risk distribution
  const { data: riskData } = await adminClient
    .from("verification_steps")
    .select("risk_level")
    .gte("submitted_at", since);

  const riskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
  if (riskData) {
    for (const row of riskData) {
      const level = row.risk_level as keyof typeof riskDistribution;
      if (level in riskDistribution) {
        riskDistribution[level]++;
      }
    }
  }

  // Average review time (hours) for reviewed steps
  const { data: reviewTimeData } = await adminClient
    .from("verification_steps")
    .select("submitted_at, reviewed_at")
    .not("reviewed_at", "is", null)
    .gte("submitted_at", since)
    .limit(5000);

  let averageReviewHours: number | null = null;
  if (reviewTimeData && reviewTimeData.length > 0) {
    const totalHours = reviewTimeData.reduce((sum, row) => {
      const submitted = new Date(row.submitted_at).getTime();
      const reviewed = new Date(row.reviewed_at).getTime();
      return sum + (reviewed - submitted) / (1000 * 60 * 60);
    }, 0);
    averageReviewHours = Math.round((totalHours / reviewTimeData.length) * 10) / 10;
  }

  const total = totalSessions ?? 0;
  const completed = completedSessions ?? 0;

  return {
    totalSessions: total,
    completedSessions: completed,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    pendingReview: pendingReview ?? 0,
    averageReviewHours,
    riskDistribution,
  };
}

/**
 * Get rejection breakdown by reason code.
 */
export async function getRejectionBreakdown(periodDays = 30): Promise<RejectionBreakdown[]> {
  const adminClient = createAdminClient();
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await adminClient
    .from("verification_steps")
    .select("override_reason_code")
    .eq("status", "rejected")
    .gte("submitted_at", since)
    .limit(5000);

  if (!data || data.length === 0) return [];

  const counts: Record<string, number> = {};
  for (const row of data) {
    const code = row.override_reason_code || "unspecified";
    counts[code] = (counts[code] || 0) + 1;
  }

  const total = data.length;
  return Object.entries(counts)
    .map(([reasonCode, count]) => ({
      reasonCode,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

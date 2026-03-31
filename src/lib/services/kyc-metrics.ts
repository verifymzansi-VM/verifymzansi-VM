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

export interface ReviewSlaMetrics {
  medianHours: number | null;
  p95Hours: number | null;
  overdueCount: number; // steps pending > SLA threshold
}

export interface KycAlertCheck {
  type: "high_risk_spike" | "rejection_spike" | "sla_breach" | "velocity_anomaly";
  triggered: boolean;
  value: number;
  threshold: number;
  message: string;
}

// ── Constants ────────────────────────────────────────────────

const SLA_HOURS = 48; // target: review within 48 hours
const HIGH_RISK_THRESHOLD_PERCENT = 15; // alert if >15% high/critical
const REJECTION_SPIKE_THRESHOLD_PERCENT = 40; // alert if >40% rejection rate
const VELOCITY_WINDOW_HOURS = 1;
const VELOCITY_MAX_SUBMISSIONS = 50; // alert if >50 submissions per hour

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
    .gte("submitted_at", since);

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
    .gte("submitted_at", since);

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

/**
 * Get review SLA metrics.
 */
export async function getReviewSlaMetrics(periodDays = 30): Promise<ReviewSlaMetrics> {
  const adminClient = createAdminClient();
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

  // Reviewed steps with timing
  const { data: decidedSteps } = await adminClient
    .from("verification_steps")
    .select("submitted_at, reviewed_at")
    .not("reviewed_at", "is", null)
    .gte("submitted_at", since);

  // Overdue: pending steps submitted > SLA_HOURS ago
  const slaThreshold = new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000).toISOString();
  const { count: overdueCount } = await adminClient
    .from("verification_steps")
    .select("*", { count: "exact", head: true })
    .eq("auto_status", "needs_manual_review")
    .is("status", null)
    .lte("submitted_at", slaThreshold);

  let medianHours: number | null = null;
  let p95Hours: number | null = null;

  if (decidedSteps && decidedSteps.length > 0) {
    const durations = decidedSteps
      .map((row) => {
        const submitted = new Date(row.submitted_at).getTime();
        const reviewed = new Date(row.reviewed_at).getTime();
        return (reviewed - submitted) / (1000 * 60 * 60);
      })
      .sort((a, b) => a - b);

    const mid = Math.floor(durations.length / 2);
    medianHours =
      durations.length % 2 === 0
        ? Math.round(((durations[mid - 1] + durations[mid]) / 2) * 10) / 10
        : Math.round(durations[mid] * 10) / 10;

    const p95Index = Math.floor(durations.length * 0.95);
    p95Hours = Math.round(durations[Math.min(p95Index, durations.length - 1)] * 10) / 10;
  }

  return {
    medianHours,
    p95Hours,
    overdueCount: overdueCount ?? 0,
  };
}

/**
 * Run alert checks and return triggered alerts.
 */
export async function checkKycAlerts(periodDays = 7): Promise<KycAlertCheck[]> {
  const alerts: KycAlertCheck[] = [];
  const adminClient = createAdminClient();
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

  // 1. High-risk spike
  const { data: riskData } = await adminClient
    .from("verification_steps")
    .select("risk_level")
    .gte("submitted_at", since);

  if (riskData && riskData.length > 0) {
    const highCritical = riskData.filter(
      (r) => r.risk_level === "high" || r.risk_level === "critical"
    ).length;
    const percent = Math.round((highCritical / riskData.length) * 100);
    alerts.push({
      type: "high_risk_spike",
      triggered: percent > HIGH_RISK_THRESHOLD_PERCENT,
      value: percent,
      threshold: HIGH_RISK_THRESHOLD_PERCENT,
      message: `${percent}% of submissions are high/critical risk (threshold: ${HIGH_RISK_THRESHOLD_PERCENT}%)`,
    });
  }

  // 2. Rejection spike
  const { count: totalDecisions } = await adminClient
    .from("verification_steps")
    .select("*", { count: "exact", head: true })
    .in("status", ["approved", "rejected"])
    .gte("submitted_at", since);

  const { count: totalRejections } = await adminClient
    .from("verification_steps")
    .select("*", { count: "exact", head: true })
    .eq("status", "rejected")
    .gte("submitted_at", since);

  const rejectionRate =
    (totalDecisions ?? 0) > 0
      ? Math.round(((totalRejections ?? 0) / (totalDecisions ?? 1)) * 100)
      : 0;

  alerts.push({
    type: "rejection_spike",
    triggered: rejectionRate > REJECTION_SPIKE_THRESHOLD_PERCENT,
    value: rejectionRate,
    threshold: REJECTION_SPIKE_THRESHOLD_PERCENT,
    message: `${rejectionRate}% rejection rate in last ${periodDays}d (threshold: ${REJECTION_SPIKE_THRESHOLD_PERCENT}%)`,
  });

  // 3. SLA breach
  const slaThreshold = new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000).toISOString();
  const { count: overdueCount } = await adminClient
    .from("verification_steps")
    .select("*", { count: "exact", head: true })
    .eq("auto_status", "needs_manual_review")
    .is("status", null)
    .lte("submitted_at", slaThreshold);

  alerts.push({
    type: "sla_breach",
    triggered: (overdueCount ?? 0) > 0,
    value: overdueCount ?? 0,
    threshold: 0,
    message: `${overdueCount ?? 0} steps waiting beyond ${SLA_HOURS}h SLA`,
  });

  // 4. Velocity anomaly (submissions per hour)
  const velocitySince = new Date(Date.now() - VELOCITY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { count: recentSubmissions } = await adminClient
    .from("verification_steps")
    .select("*", { count: "exact", head: true })
    .gte("submitted_at", velocitySince);

  alerts.push({
    type: "velocity_anomaly",
    triggered: (recentSubmissions ?? 0) > VELOCITY_MAX_SUBMISSIONS,
    value: recentSubmissions ?? 0,
    threshold: VELOCITY_MAX_SUBMISSIONS,
    message: `${recentSubmissions ?? 0} submissions in last ${VELOCITY_WINDOW_HOURS}h (threshold: ${VELOCITY_MAX_SUBMISSIONS})`,
  });

  return alerts;
}

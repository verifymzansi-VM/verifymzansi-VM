import type { ReportSeverity } from "@/types/enums";

export type SlaState = "on-track" | "at-risk" | "breached";

export interface SlaResult {
  state: SlaState;
  hoursRemaining: number;
  hoursElapsed: number;
  slaHours: number;
}

/** SLA hours by severity */
const SLA_HOURS: Record<ReportSeverity, number> = {
  high: 4,
  standard: 24,
};

/**
 * Calculate the SLA state for a moderation report.
 */
export function calculateSlaState(
  createdAt: Date | string,
  severity: ReportSeverity,
  resolvedAt?: Date | string | null
): SlaResult {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const resolved = resolvedAt
    ? typeof resolvedAt === "string"
      ? new Date(resolvedAt)
      : resolvedAt
    : null;

  const slaHours = SLA_HOURS[severity];
  const endPoint = resolved || new Date();
  const hoursElapsed = (endPoint.getTime() - created.getTime()) / (1000 * 60 * 60);
  const hoursRemaining = Math.max(0, slaHours - hoursElapsed);

  let state: SlaState;
  if (resolved) {
    state = hoursElapsed <= slaHours ? "on-track" : "breached";
  } else if (hoursRemaining <= 0) {
    state = "breached";
  } else if (hoursRemaining <= slaHours * 0.25) {
    state = "at-risk";
  } else {
    state = "on-track";
  }

  return { state, hoursRemaining, hoursElapsed, slaHours };
}

/** Sort priority for SLA states (lower = higher priority in queue) */
export function slaSortPriority(state: SlaState): number {
  switch (state) {
    case "breached":
      return 1;
    case "at-risk":
      return 2;
    case "on-track":
      return 3;
  }
}

/** Format elapsed hours as a human-readable string */
export function formatElapsed(hours: number): string {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.floor(hours % 24);
    return `${days}d ${remainingHours}h`;
  }
  if (hours >= 1) {
    const h = Math.floor(hours);
    const m = Math.floor((hours % 1) * 60);
    return `${h}h ${m}m`;
  }
  return `${Math.floor(hours * 60)}m`;
}

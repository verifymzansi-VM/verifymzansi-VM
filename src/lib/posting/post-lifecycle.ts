import { FREE_POST_CONFIG, PAID_POST_CONFIG } from "@/lib/constants/pricing";

function getFreePostExpiryDate(from = new Date()): Date {
  return new Date(from.getTime() + FREE_POST_CONFIG.durationDays * 24 * 60 * 60 * 1000);
}

export function getFreePostExpiryIso(from = new Date()): string {
  return getFreePostExpiryDate(from).toISOString();
}

function getPaidPostExpiryDate(from = new Date()): Date {
  return new Date(from.getTime() + PAID_POST_CONFIG.durationDays * 24 * 60 * 60 * 1000);
}

export function getPaidPostExpiryIso(from = new Date()): string {
  return getPaidPostExpiryDate(from).toISOString();
}

export function getPostExpiryIso(
  { hasPaidPlan }: { hasPaidPlan: boolean },
  from = new Date()
): string {
  return hasPaidPlan ? getPaidPostExpiryIso(from) : getFreePostExpiryIso(from);
}

export function getPostVisibilityDurationDaysFromStoredExpiry({
  createdAt,
  expiresAt,
}: {
  createdAt: string | null | undefined;
  expiresAt: string | null | undefined;
}): number {
  if (!createdAt || !expiresAt) {
    return FREE_POST_CONFIG.durationDays;
  }

  const createdTime = new Date(createdAt).getTime();
  const expiryTime = new Date(expiresAt).getTime();
  if (!Number.isFinite(createdTime) || !Number.isFinite(expiryTime) || expiryTime <= createdTime) {
    return FREE_POST_CONFIG.durationDays;
  }

  const durationDays = Math.round((expiryTime - createdTime) / (24 * 60 * 60 * 1000));
  const paidThreshold = (FREE_POST_CONFIG.durationDays + PAID_POST_CONFIG.durationDays) / 2;
  return durationDays >= paidThreshold
    ? PAID_POST_CONFIG.durationDays
    : FREE_POST_CONFIG.durationDays;
}

export function getApprovedPostExpiryIso(
  {
    createdAt,
    expiresAt,
  }: {
    createdAt: string | null | undefined;
    expiresAt: string | null | undefined;
  },
  approvedAt = new Date()
): string {
  const durationDays = getPostVisibilityDurationDaysFromStoredExpiry({ createdAt, expiresAt });
  const baseline = approvedAt;
  const baselineTime = baseline.getTime();
  const safeBaseline = Number.isFinite(baselineTime) ? baseline : approvedAt;
  return new Date(safeBaseline.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

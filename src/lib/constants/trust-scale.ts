/* ══════════════════════════════════════════════════════════════
   TRUST VERIFICATION SCALE
   5-tier visual system that communicates seller trustworthiness.
   Maps DB status + entitlement tier → visual treatment.
   ══════════════════════════════════════════════════════════════ */

import type { TrustLevel, SellerVerificationStatus, PlanTier, AccountStatus } from "@/types/enums";

export interface TrustTier {
  level: TrustLevel;
  label: string;
  description: string;
  badgeClass: string;
  cardClass: string;
  borderColor: string;
  iconName: string;
  glowAnimation: boolean;
}

export const TRUST_TIERS: Record<TrustLevel, TrustTier> = {
  0: {
    level: 0,
    label: "Unregistered",
    description: "No seller profile",
    badgeClass: "trust-badge-0",
    cardClass: "trust-card-0",
    borderColor: "border-warm-200",
    iconName: "Circle",
    glowAnimation: false,
  },
  1: {
    level: 1,
    label: "Incomplete",
    description: "Verification not started",
    badgeClass: "trust-badge-1",
    cardClass: "trust-card-1",
    borderColor: "border-warm-300",
    iconName: "CircleDashed",
    glowAnimation: false,
  },
  2: {
    level: 2,
    label: "Pending Review",
    description: "Verification submitted, awaiting review",
    badgeClass: "trust-badge-2",
    cardClass: "trust-card-2",
    borderColor: "border-brand-gold-300",
    iconName: "Clock",
    glowAnimation: true,
  },
  3: {
    level: 3,
    label: "Verified",
    description: "Identity verified by VerifyMzansi",
    badgeClass: "trust-badge-3",
    cardClass: "trust-card-3",
    borderColor: "border-brand-green-400",
    iconName: "ShieldCheck",
    glowAnimation: false,
  },
  4: {
    level: 4,
    label: "Verified Pro",
    description: "Verified seller with Pro subscription",
    badgeClass: "trust-badge-4",
    cardClass: "trust-card-4",
    borderColor: "border-brand-green-400",
    iconName: "Crown",
    glowAnimation: true,
  },
};

/**
 * Compute the trust level from seller verification status, plan tier,
 * and account penalties (strikes, suspension, ban, legal hold).
 */
export function computeTrustLevel(
  verificationStatus: SellerVerificationStatus | null,
  planTier?: PlanTier | null,
  accountStatus?: AccountStatus | null,
  options?: { strikes?: number; legalHold?: boolean }
): TrustLevel {
  if (!verificationStatus) return 0;

  // Banned accounts are always level 0
  if (accountStatus === "banned") return 0;

  // Suspended, legal-hold, or 3+ strikes caps at level 1
  if (
    accountStatus === "suspended" ||
    options?.legalHold ||
    (options?.strikes && options.strikes >= 3)
  ) {
    // Still compute the base level but cap it
    const base = computeBaseLevel(verificationStatus, planTier);
    return Math.min(base, 1) as TrustLevel;
  }

  return computeBaseLevel(verificationStatus, planTier);
}

function computeBaseLevel(
  verificationStatus: SellerVerificationStatus,
  planTier?: PlanTier | null
): TrustLevel {
  switch (verificationStatus) {
    case "incomplete":
      return 1;
    case "pending_review":
      return 2;
    case "verified":
      return planTier === "pro" ? 4 : 3;
    default:
      return 0;
  }
}

/**
 * Get the trust tier config for a given level.
 */
export function getTrustTier(level: TrustLevel): TrustTier {
  return TRUST_TIERS[level];
}

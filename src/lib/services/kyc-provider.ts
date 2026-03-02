import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import type {
  IKycProvider,
  KycProviderSubmission,
  KycProviderResult,
} from "./kyc-provider-interface";

const log = createLogger("KycProvider");

// ── Null scores returned by the simulator ────────────────────
const NULL_SCORES = {
  faceMatchScore: null,
  livenessScore: null,
  docAuthScore: null,
  ocrPayload: {},
  rawResponse: {},
} as const;

/**
 * Simulates a third-party automated KYC verification (e.g. SmileID or Veriff).
 * Routes ALL submissions to manual review — safe default for launch without a
 * real vendor. Returns structured KycProviderResult including null scores.
 */
async function simulateKycVerification(
  idImageR2Key: string,
  idNumber?: string
): Promise<KycProviderResult> {
  log.info("Simulating automated KYC verification", {
    idLength: idNumber?.length,
  });

  // Simulate network / processing delay (1–2 seconds)
  const delay = Math.floor(Math.random() * 1000) + 1000;
  await new Promise((resolve) => setTimeout(resolve, delay));

  if (!idImageR2Key) {
    log.warn("KYC simulation failed: missing ID image R2 key");
    return {
      status: "rejected",
      reason: "Missing ID document image",
      providerReference: `sim_rej_${crypto.randomUUID()}`,
      scores: { ...NULL_SCORES, rawResponse: { reason: "missing_id_image" } },
    };
  }

  if (idNumber && idNumber.length !== 13) {
    log.warn("KYC simulation failed: invalid SA ID number format", {
      idNumberLength: idNumber.length,
    });
    return {
      status: "rejected",
      reason: "ID number must be exactly 13 digits",
      providerReference: `sim_rej_${crypto.randomUUID()}`,
      scores: {
        ...NULL_SCORES,
        rawResponse: { reason: "invalid_id_number_length" },
      },
    };
  }

  // Route everything to manual review — production-safe simulator.
  log.info("KYC simulation complete: routing to manual review");
  return {
    status: "needs_manual_review",
    reason: "Automated KYC Provider Simulator: Routed to manual queue for human verification.",
    providerReference: `sim_rev_${crypto.randomUUID()}`,
    scores: NULL_SCORES,
  };
}

// ── StubKycProvider ───────────────────────────────────────────

/**
 * Concrete IKycProvider implementation using the local simulator.
 * Replace or augment this class (or add a new class) when integrating
 * a real provider such as SmileID or Veriff, then update
 * getConfiguredProvider() to return the real implementation.
 */
export class StubKycProvider implements IKycProvider {
  readonly name = "stub";

  async submitIdentity(submission: KycProviderSubmission): Promise<KycProviderResult> {
    return simulateKycVerification(submission.idImageR2Key, submission.idNumber);
  }
}

/**
 * Returns the currently active IKycProvider.
 * Change this function to switch providers without touching call sites.
 *
 * Set `KYC_PROVIDER` env var to explicitly declare the provider.
 * Default: "stub" — all verifications route to manual review.
 */
export function getConfiguredProvider(): IKycProvider {
  const provider = process.env.KYC_PROVIDER || "stub";
  if (provider === "stub") {
    log.warn("KYC_PROVIDER=stub: All verifications route to manual review");
  }
  return new StubKycProvider();
}

// ── Backward-compatibility exports ───────────────────────────
// Kept so existing tests and callers continue to compile during the migration.

/** @deprecated Use getConfiguredProvider().submitIdentity() instead */
export async function submitIdentityToProvider(
  idImageUrl: string,
  _selfieImageUrl?: string,
  idNumber?: string
): Promise<{ status: string; reason?: string; providerReference?: string }> {
  const result = await simulateKycVerification(idImageUrl, idNumber);
  return {
    status: result.status,
    reason: result.reason,
    providerReference: result.providerReference,
  };
}

// Re-export types so existing imports from this file keep working.
export type {
  KycProviderResult,
  IKycProvider,
  KycProviderSubmission,
} from "./kyc-provider-interface";

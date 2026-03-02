/**
 * Provider-agnostic KYC interface.
 * Swap the concrete adapter (StubKycProvider → SmileID, Veriff, etc.)
 * by returning a different IKycProvider from getConfiguredProvider()
 * without touching any call sites.
 */

export interface KycProviderSubmission {
  /** Cloudflare R2 key of the encrypted ID document */
  idImageR2Key: string;
  /** Cloudflare R2 key of the encrypted selfie (optional) */
  selfieImageR2Key?: string;
  /** Raw SA ID number (13 digits) — only sent for id_document steps */
  idNumber?: string;
  /** UUID of the kyc_artifacts row just created */
  artifactId: string;
  /** UUID of the authenticated user */
  userId: string;
}

export interface KycProviderScores {
  /** 0–100: how closely the selfie matches the ID portrait */
  faceMatchScore: number | null;
  /** 0–100: liveness detection confidence */
  livenessScore: number | null;
  /** 0–100: document authenticity confidence */
  docAuthScore: number | null;
  /** Structured OCR fields extracted from the document */
  ocrPayload: Record<string, unknown>;
  /** Full raw provider response (for debugging / future use) */
  rawResponse: Record<string, unknown>;
}

export interface KycProviderResult {
  status: "approved" | "rejected" | "needs_manual_review";
  reason?: string;
  /** Provider-issued unique reference for this submission */
  providerReference?: string;
  scores: KycProviderScores;
}

export interface IKycProvider {
  /** Human-readable name stored in kyc_provider_results.provider_name */
  readonly name: string;
  submitIdentity(submission: KycProviderSubmission): Promise<KycProviderResult>;
}

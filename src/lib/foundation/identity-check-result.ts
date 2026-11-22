import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FoundationServiceApi } from "./service-api";
import {
  DiditError,
  fetchDiditDecision,
  fetchDiditImage,
  type DiditConfig,
  type DiditDecision,
} from "./didit-client";
import { sessionMoved } from "./identity-check-context";
import {
  cleanEvidence,
  FoundationVerificationError,
  verificationSecret,
} from "./verification-runtime";
import { processIdentityNumber } from "../domains/verification/identity-processing";
import { isUnder18FromSaId, validateSaIdChecksum } from "../utils/sa-id-validation";
import { detectMimeFromMagicBytes } from "../utils/file-validation";
import { encryptData, decryptData } from "../utils/encryption";
import { putImmutableR2Bytes } from "../services/storage";

/**
 * Looks at a partner session again and records its result once
 * (api.complete_identity_check). Called when the partner's webhook says a
 * session changed; the webhook body itself is never trusted. Safe to repeat:
 * a check that already has its result is answered as it was.
 */
type Outcome = "approved" | "declined" | "in_review" | "not_finished";
type Reason =
  "names_differ" | "document_not_accepted" | "id_number_invalid" | "under_18" | "session_moved";

/** The partner's status as a result, or null while the session is still going. */
export function outcomeOf(status: string): Outcome | null {
  switch (status) {
    case "Approved":
      return "approved";
    case "Declined":
      return "declined";
    case "In Review":
      return "in_review";
    case "Expired":
    case "Abandoned":
      return "not_finished";
    default:
      return null;
  }
}

/** Names compared without regard to case or spacing, composed to one Unicode
 * form (NFC: the same letters typed as one character or as letter plus mark).
 * Look-alike forms such as full-width letters stay different. The ID prints
 * names in capitals. */
export const comparableName = (value: string | null | undefined) =>
  (value ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export function namesMatch(
  typed: { first_name: string; last_name: string },
  onId: { first_name?: string | null; last_name?: string | null }
) {
  const first = comparableName(onId.first_name);
  const last = comparableName(onId.last_name);
  return (
    first !== "" &&
    last !== "" &&
    first === comparableName(typed.first_name) &&
    last === comparableName(typed.last_name)
  );
}

/** api.begin_identity_check_evidence's answer, exactly. */
const reserved = z.strictObject({
  // The member's account: the ID number is encrypted for it and the risk
  // assessment is made for it (the webhook has no member session).
  owner_id: z.uuid(),
  id_front: z.strictObject({ artifact_id: z.uuid(), object_key: z.string() }),
  selfie: z.strictObject({ artifact_id: z.uuid(), object_key: z.string() }),
  // What the database recorded when the member started: the legal names
  // they typed, the keyed hash of their network and the kind of device.
  start: z.strictObject({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    network_hash: z.string().nullable(),
    device_kind: z.string().nullable(),
  }),
});
const stored = /^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * A failure that the same delivery can never get past (the partner should
 * stop retrying): the reason is a short code for the logs.
 */
export class PermanentResultError extends Error {
  override name = "PermanentResultError";
  constructor(readonly reason: "decision_not_found" | "photo_unsupported" | "evidence_mismatch") {
    super(`Identity check result cannot be recorded: ${reason}`);
  }
}

/** A photo copied into our own encrypted storage, as the manual route stores it. */
async function storePhoto(key: string, url: string, selfie: boolean) {
  const original = await fetchDiditImage(url);
  const mime = detectMimeFromMagicBytes(original) ?? "application/octet-stream";
  const bytes = await cleanEvidence(
    new File([new Uint8Array(original)], "photo", { type: mime }),
    selfie
  ).catch((error: unknown) => {
    if (error instanceof FoundationVerificationError && [400, 413].includes(error.status))
      throw new PermanentResultError("photo_unsupported");
    throw error;
  });
  const encrypted = await putImmutableR2Bytes(
    process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    key,
    await encryptData(bytes)
  );
  const actual = await decryptData(encrypted);
  if (actual.length !== bytes.length || !timingSafeEqual(actual, bytes))
    throw new PermanentResultError("evidence_mismatch");
  return {
    content: sha256(bytes),
    receipt: {
      stored_sha256: sha256(encrypted),
      content_sha256: sha256(bytes),
      size: encrypted.length,
    },
  };
}

export type IdentityCheckResult = { recorded: boolean; status: string };

export async function recordIdentityCheckResult(
  service: FoundationServiceApi,
  config: DiditConfig,
  sessionId: string
): Promise<IdentityCheckResult> {
  const decision: DiditDecision = await fetchDiditDecision(config, sessionId).catch(
    (error: unknown) => {
      if (error instanceof DiditError && error.status === 404)
        throw new PermanentResultError("decision_not_found");
      throw error;
    }
  );
  if (decision.session_id !== sessionId) throw new Error("Identity check session changed");
  // A session this site did not start (for example a test in the partner's
  // console) carries no check id: nothing to record.
  const checkId = z.uuid().safeParse(decision.vendor_data);
  if (!checkId.success) return { recorded: false, status: "not_ours" };
  const outcome = outcomeOf(decision.status);
  if (!outcome) return { recorded: false, status: decision.status };
  const check = checkId.data;
  const complete = async (args: {
    outcome: Outcome;
    reasons?: Reason[];
    evidence?: Record<string, unknown>;
  }): Promise<IdentityCheckResult> => {
    const done = await service.rpc("complete_identity_check", {
      p_check: check,
      p_session_id: sessionId,
      p_outcome: args.outcome,
      p_reasons: args.reasons ?? [],
      ...args.evidence,
    });
    // An unknown check (or one whose session changed) has nothing to record.
    if (done.error?.code === "PT409") return { recorded: false, status: "unavailable" };
    if (done.error) throw new Error("Identity check result was not recorded");
    const status = z.object({ status: z.string() }).parse(done.data).status;
    return { recorded: true, status };
  };

  const document = decision.id_verifications?.[0];
  const face = decision.liveness_checks?.[0];
  // Nothing a person could review.
  if (outcome === "not_finished" || !document?.front_image || !face?.reference_image)
    return complete({ outcome: "not_finished" });
  // Only a valid adult South African ID number becomes a submission; anything
  // else keeps nothing (the partner's copy is deleted at once).
  const number = (document.personal_number ?? "").replace(/\s/g, "");
  if (!/^\d{13}$/.test(number) || !validateSaIdChecksum(number))
    return complete({ outcome: "not_finished", reasons: ["id_number_invalid"] });
  if (isUnder18FromSaId(number) !== false)
    return complete({ outcome: "not_finished", reasons: ["under_18"] });

  const begun = await service.rpc("begin_identity_check_evidence", {
    p_check: check,
    p_session_id: sessionId,
  });
  // Already recorded, or the member's identity changed meanwhile: the
  // completion below answers or closes the check without evidence.
  if (begun.error?.code === "PT409") return complete({ outcome: "not_finished" });
  if (begun.error) throw new Error("Identity check evidence was not reserved");
  const targets = reserved.parse(begun.data);
  if (!stored.test(targets.id_front.object_key) || !stored.test(targets.selfie.object_key))
    throw new Error("Identity check evidence target changed");
  const { start } = targets;
  const reasons: Reason[] = [];
  if (!namesMatch(start, document)) reasons.push("names_differ");
  if (document.issuing_state !== "ZAF") reasons.push("document_not_accepted");
  // The link was opened on another network or kind of device: the result
  // goes to a person (or is declined, with "ask a person", when automatic).
  // Every IP analysis the partner reports must match; none at all counts as moved.
  const analyses = decision.ip_analyses ?? [];
  if (analyses.length === 0 || analyses.some((seen) => sessionMoved(start, seen)))
    reasons.push("session_moved");
  const [idFront, selfie] = await Promise.all([
    storePhoto(targets.id_front.object_key, document.front_image, false),
    storePhoto(targets.selfie.object_key, face.reference_image, true),
  ]).catch(async (error: unknown) => {
    // A photo we can never use: close the check now (the member can start
    // again) instead of leaving it open until it expires.
    if (error instanceof PermanentResultError && error.reason === "photo_unsupported")
      await complete({ outcome: "not_finished" });
    throw error;
  });
  const identity = processIdentityNumber(targets.owner_id, number, {
    identityMatchKey: verificationSecret("HMAC_SECRET").toString("hex"),
    numberEncryptionKey: verificationSecret("ID_ENCRYPTION_KEY").toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  });
  const assessed = await service.rpc("assess_identity_upload", {
    p_owner: targets.owner_id,
    p_fingerprint: identity.fingerprint,
    p_document_sha256: idFront.content,
    p_selfie_sha256: selfie.content,
  });
  if (assessed.error) throw new Error("Identity check risk was not assessed");
  const risk = z.object({ risk_score: z.number().int().min(0).max(100) }).parse(assessed.data);
  return complete({
    outcome,
    reasons,
    evidence: {
      p_id_front: idFront.receipt,
      p_selfie: selfie.receipt,
      p_identity: { fingerprint: identity.fingerprint, encrypted_number: identity.encryptedNumber },
      // The names recorded at the start, exactly; the database marks the
      // result names_differ if the profile changed during the check.
      p_names: { first_name: start.first_name, last_name: start.last_name },
      p_risk_score: risk.risk_score,
    },
  });
}

import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FoundationServiceApi } from "./service-api";
import {
  fetchDiditDecision,
  fetchDiditImage,
  type DiditConfig,
  type DiditDecision,
} from "./didit-client";
import { openStartContext, sessionMoved } from "./identity-check-context";
import { cleanEvidence, verificationSecret } from "./verification-runtime";
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
type Reason = "names_differ" | "document_not_accepted" | "id_number_invalid" | "under_18";

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

/** Names compared without regard to case, Unicode form or spacing (the ID
 * prints names in capitals). */
export const comparableName = (value: string | null | undefined) =>
  (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function namesMatch(
  typed: { first: string; last: string },
  onId: { first_name?: string | null; last_name?: string | null }
) {
  const first = comparableName(onId.first_name);
  const last = comparableName(onId.last_name);
  return (
    first !== "" &&
    last !== "" &&
    first === comparableName(typed.first) &&
    last === comparableName(typed.last)
  );
}

const reserved = z.object({
  id_front: z.object({ artifact_id: z.uuid(), object_key: z.string() }),
  selfie: z.object({ artifact_id: z.uuid(), object_key: z.string() }),
});
const stored = /^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A photo copied into our own encrypted storage, as the manual route stores it. */
async function storePhoto(key: string, url: string, selfie: boolean) {
  const original = await fetchDiditImage(url);
  const mime = detectMimeFromMagicBytes(original) ?? "application/octet-stream";
  const bytes = await cleanEvidence(
    new File([new Uint8Array(original)], "photo", { type: mime }),
    selfie
  );
  const encrypted = await putImmutableR2Bytes(
    process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    key,
    await encryptData(bytes)
  );
  const actual = await decryptData(encrypted);
  if (actual.length !== bytes.length || !timingSafeEqual(actual, bytes))
    throw new Error("Stored evidence does not match the check");
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
  const decision: DiditDecision = await fetchDiditDecision(config, sessionId);
  if (decision.session_id !== sessionId) throw new Error("Identity check session changed");
  // A session this site did not start (for example a test in the partner's
  // console) carries no check id: nothing to record.
  const checkId = z.uuid().safeParse(decision.vendor_data);
  if (!checkId.success) return { recorded: false, status: "not_ours" };
  let outcome = outcomeOf(decision.status);
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

  const start = openStartContext(check, decision.metadata?.start);
  const document = decision.id_verifications?.[0];
  const face = decision.liveness_checks?.[0];
  // Nothing a person could review, or not a session this site started.
  if (outcome === "not_finished" || !start || !document?.front_image || !face?.reference_image)
    return complete({ outcome: "not_finished" });
  // Only a valid adult South African ID number becomes a submission; anything
  // else keeps nothing (the partner's copy is deleted at once).
  const number = (document.personal_number ?? "").replace(/\s/g, "");
  if (!/^\d{13}$/.test(number) || !validateSaIdChecksum(number))
    return complete({ outcome: "not_finished", reasons: ["id_number_invalid"] });
  if (isUnder18FromSaId(number) !== false)
    return complete({ outcome: "not_finished", reasons: ["under_18"] });

  const reasons: Reason[] = [];
  if (!namesMatch(start, document)) reasons.push("names_differ");
  if (document.issuing_state !== "ZAF") reasons.push("document_not_accepted");
  // The link was opened elsewhere: a clean pass goes to a person (or is
  // declined on the fully automatic setting, where "ask a person" is open).
  if (outcome === "approved" && sessionMoved(start, decision.ip_analyses?.[0]))
    outcome = "in_review";

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
  const [idFront, selfie] = await Promise.all([
    storePhoto(targets.id_front.object_key, document.front_image, false),
    storePhoto(targets.selfie.object_key, face.reference_image, true),
  ]);
  const identity = processIdentityNumber(start.owner, number, {
    identityMatchKey: verificationSecret("HMAC_SECRET").toString("hex"),
    numberEncryptionKey: verificationSecret("ID_ENCRYPTION_KEY").toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  });
  const assessed = await service.rpc("assess_identity_upload", {
    p_owner: start.owner,
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
      // Exactly the names the member typed; the database marks the result
      // names_differ if they changed during the check.
      p_names: { first_name: start.first, last_name: start.last },
      p_risk_score: risk.risk_score,
    },
  });
}

import { nativeTotp } from "./foundation-native-totp.mjs";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { processIdentityNumber } from "../../src/lib/domains/verification/identity-processing.ts";
import { validateSaIdChecksum } from "../../src/lib/utils/sa-id-validation.ts";

const uuid = (value) => {
  assert.match(value, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  return value;
};

/** Explicit positive local fixture primitives. No createUser default, verified
 * flag, trial grant or physical/provider attestation. The independent reviewer
 * must already have a genuine AAL2/current staff session from its harness. */
export function createTrustedPostingFixture({ rpc, sql, reviewer }) {
  uuid(reviewer.id);
  const keys = {
    identityMatchKey: randomBytes(32).toString("hex"),
    numberEncryptionKey: randomBytes(32).toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  };
  let sequence = 3000;
  const number = () => {
    const prefix = "800101" + String(sequence++).padStart(4, "0") + "08";
    for (let digit = 0; digit < 10; digit++)
      if (validateSaIdChecksum(prefix + digit)) return prefix + digit;
    throw new Error("Synthetic identity checksum unavailable");
  };
  const call = async (name, body, token, service = false) => {
    const result = await rpc(name, body, service ? null : token, service);
    assert.equal(result.status, 200, "trusted posting fixture " + name);
    return result.data;
  };
  const identity = async (owner) => {
    if (typeof reviewer.refresh === "function") await reviewer.refresh();
    uuid(owner.id);
    assert.notEqual(owner.id, reviewer.id, "Fixture requires independent reviewer");
    const opened = await call("open_verification_case", {}, owner.token);
    const caseId = uuid(opened.case_id);
    assert.equal(opened.read_only, false, "Use a fresh mutable verification subject");
    const artifacts = [];
    for (const purpose of ["id_front", "selfie"]) {
      const begun = await call(
        "begin_evidence_upload",
        { p_case_id: caseId, p_purpose: purpose },
        owner.token
      );
      const artifact = uuid(begun.artifact_id);
      artifacts.push(artifact);
      // Explicit synthetic scanner/object metadata; no real bytes or provider.
      for (const state of ["uploaded", "clean"])
        await call(
          "advance_evidence_artifact",
          {
            p_artifact_id: artifact,
            p_state: state,
            p_sha256: createHash("sha256")
              .update(owner.id + purpose)
              .digest("hex"),
            p_size: 128,
          },
          null,
          true
        );
    }
    const processed = processIdentityNumber(owner.id, number(), keys);
    // Harness-only metadata read: never creates acceptance or verification facts.
    const version = Number(
      sql("select version from private.evidence_cases where id='" + caseId + "';")
    );
    assert.ok(Number.isSafeInteger(version) && version > 0 && version < 2147483647);
    const submitted = await call(
      "register_identity_submission",
      {
        p_case: caseId,
        p_expected_version: version,
        p_id_artifact: artifacts[0],
        p_selfie_artifact: artifacts[1],
        p_fingerprint: processed.fingerprint,
        p_identity_key: processed.identityKeyId,
        p_encrypted_number: processed.encryptedNumber,
        p_receipt: randomUUID(),
        p_risk_score: 10,
      },
      null,
      true
    );
    const lease = await call("claim_evidence_case", { p_case_id: caseId }, reviewer.token);
    const reviewed = await call(
      "review_identity_submission",
      {
        p_submission: uuid(submitted.submission_id),
        p_expected_version: submitted.case_version,
        p_claim_generation: lease.claim_generation,
        p_claim_nonce: lease.claim_nonce,
        p_number_matches: true,
        p_selfie_matches: true,
      },
      reviewer.token
    );
    assert.equal(reviewed.status, "accepted");
    return {
      caseId,
      submissionId: submitted.submission_id,
      factId: uuid(reviewed.identity_fact_id),
    };
  };
  const phone = async (owner) => {
    uuid(owner.id);
    const value = "+277" + String(randomBytes(4).readUInt32BE(0) % 100000000).padStart(8, "0"),
      hash = randomBytes(32).toString("hex");
    const challenge = await call(
      "create_verification_phone_challenge",
      { p_owner: owner.id, p_phone: value, p_hash: hash },
      null,
      true
    );
    const id = uuid(challenge.challenge_id);
    await call(
      "claim_verification_phone_attempt",
      { p_owner: owner.id, p_challenge: id },
      null,
      true
    );
    const verified = await call(
      "finalize_verification_phone",
      { p_owner: owner.id, p_challenge: id, p_expected_hash: hash },
      null,
      true
    );
    assert.equal(verified.verified, true);
    return { proofId: uuid(verified.proof_id), phone: value };
  };
  const locality = async (owner) => {
    uuid(owner.id);
    const result = await call(
      "confirm_verification_locality",
      { p_province: "gp", p_city: "gp_johannesburg" },
      owner.token
    );
    assert.equal(result.assurance, "self_declared");
    return result;
  };
  const ready = async (owner) => {
    const accepted = await identity(owner),
      confirmed = await phone(owner);
    await locality(owner);
    assert.equal(
      sql("select internal.current_verified_identity('" + uuid(owner.id) + "') is not null;"),
      "t"
    );
    return { ...accepted, ...confirmed };
  };
  return { identity, phone, locality, ready };
}

/** Trusted harness role setup, then real Auth/TOTP. The role insertion is not
 * evidence acceptance; the routine review still runs as this actual caller. */
export async function createPostingVerifier({ createUser, sql, fixtureAdminId }) {
  uuid(fixtureAdminId);
  const reviewer = await createUser("posting-verification-reviewer");
  uuid(reviewer.id);
  const enrolled = await reviewer.member.auth.mfa.enroll({ factorType: "totp" });
  assert.equal(enrolled.error, null);
  const factorId = enrolled.data.id,
    secret = enrolled.data.totp.secret;
  let lastVerifiedAt = 0;
  const refresh = async () => {
    // A local scheduling hint only. Fresh authority still comes from GoTrue/SQL;
    // no claim or server AMR timestamp is forged, extended or restored here.
    if (Date.now() - lastVerifiedAt < 120000) return reviewer;
    const challenge = await reviewer.member.auth.mfa.challenge({ factorId });
    assert.equal(challenge.error, null);
    const verified = await reviewer.member.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: nativeTotp(secret),
    });
    assert.equal(verified.error, null);
    reviewer.token = (await reviewer.member.auth.getSession()).data.session.access_token;
    const claims = JSON.parse(Buffer.from(reviewer.token.split(".")[1], "base64url"));
    assert.equal(claims.sub, reviewer.id);
    assert.equal(claims.aal, "aal2");
    uuid(claims.session_id);
    lastVerifiedAt = Date.now();
    return reviewer;
  };
  reviewer.refresh = refresh;
  await refresh();
  sql(
    "insert into private.staff_roles(user_id,role,granted_by) values('" +
      reviewer.id +
      "','governor','" +
      fixtureAdminId +
      "');"
  );
  return reviewer;
}

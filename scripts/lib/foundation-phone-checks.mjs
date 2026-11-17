// Phone verification steps for the update behaviour checks, made through the
// production service commands (create, claim, finalize) as the website's
// server does. No SMS is sent and no OTP key is involved: the HMAC check lives
// in the website, so any stored digest is accepted at the last step.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

/**
 * `helpers` are the update check's sqlHelpers (q, json, fails, service).
 * Returns SQL builders and steps for synthetic members ({ id }).
 */
export function phoneChecks({ q, json, fails, service }) {
  const hash = () => `h${randomBytes(24).toString("hex")}`;
  /** SQL that asks for a code for `phone` (run with q, or fails). */
  const createSql = (owner, phone, digest = hash()) =>
    service(
      `select api.create_verification_phone_challenge('${owner.id}','${phone}','${digest}');`
    );
  /** A stored challenge for `phone`, with the digest it was stored with. */
  const create = (owner, phone) => {
    const digest = hash();
    return { digest, ...json(createSql(owner, phone, digest)) };
  };
  /** SQL that uses one attempt of `challenge` and finalizes it. */
  const finalizeSql = (owner, challenge) =>
    service(
      `select api.claim_verification_phone_attempt('${owner.id}','${challenge.challenge_id}');
       select api.finalize_verification_phone('${owner.id}','${challenge.challenge_id}','${challenge.digest}');`
    );
  /** A verified phone for `owner`; returns the active proof's id. */
  const prove = (owner, phone) => {
    q(finalizeSql(owner, create(owner, phone)));
    return q(
      `select id from private.verification_phone_proofs where owner_id='${owner.id}' and revoked_at is null;`
    );
  };
  /** Running `sql` fails with PT409 and this listed reason; returns stderr. */
  const refusedWith = (sql, reason) => {
    const stderr = fails(sql, "PT409");
    assert.equal(/^DETAIL:\s+(\S+)/m.exec(stderr)?.[1], reason, stderr);
    return stderr;
  };
  /** How many challenges `owner` has stored. */
  const challengeCount = (owner) =>
    Number(
      q(`select count(*) from private.verification_phone_challenges where owner_id='${owner.id}';`)
    );
  return { createSql, create, finalizeSql, prove, refusedWith, challengeCount };
}

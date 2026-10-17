import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { sourceIdentityDigestToFingerprint } from "../../src/lib/domains/verification/identity-fingerprint.ts";
import { processIdentityNumber } from "../../src/lib/domains/verification/identity-processing.ts";
import { createFoundationAuthenticatedApi } from "../../src/lib/foundation/authenticated-api.ts";
import {
  readStaffIdentityContext,
  readStaffIdentityHistory,
} from "../../src/lib/foundation/staff-identity.ts";
import { validateSaIdChecksum } from "../../src/lib/utils/sa-id-validation.ts";

// Synthetic local HTTP/transaction proof; no physical object/provider attestation.
export async function testTrustedIdentity({
  rpc,
  foundationConnection,
  sql,
  sqlFails,
  record,
  staff,
  createUser,
  controlledSql,
  awaitQueuedRpc,
  stage,
}) {
  const service = (name, body) => rpc(name, body, null, true);
  const trial = (owner) => service("grant_verified_intro_trial", { p_owner: owner.id, p_days: 7 });
  const history = (owner, who = staff.governorB, cursor = {}) =>
    rpc("staff_identity_history", { p_owner: owner.id, ...cursor }, who.token);
  const authenticated = (who) => createFoundationAuthenticatedApi(foundationConnection, who.token);
  const typedHistory = async (owner, who = staff.governorB, cursor) => ({
    status: 200,
    data: await readStaffIdentityHistory(authenticated(who), {
      owner_id: owner.id,
      ...(cursor ? { cursor } : {}),
    }),
  });
  const keys = {
    identityMatchKey: randomBytes(32).toString("hex"),
    numberEncryptionKey: randomBytes(32).toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  };
  let sequence = 1000;
  const nextNumber = () => {
    const prefix = `800101${String(sequence++).padStart(4, "0")}08`;
    for (let digit = 0; digit < 10; digit++)
      if (validateSaIdChecksum(prefix + digit)) return prefix + digit;
    throw Error("Synthetic checksum unavailable");
  };
  const prepare = async (owner, risk = 10, number = nextNumber()) => {
    const processed = processIdentityNumber(owner.id, number, keys),
      fingerprint = processed.fingerprint;
    const opened = await rpc("open_verification_case", {}, owner.token);
    assert.equal(opened.status, 200);
    const caseId = opened.data.case_id;
    const artifacts = [];
    for (const purpose of ["id_front", "selfie"]) {
      const begun = await rpc(
        "begin_evidence_upload",
        { p_case_id: caseId, p_purpose: purpose },
        owner.token
      );
      assert.equal(begun.status, 200);
      const id = begun.data.artifact_id;
      artifacts.push(id);
      for (const state of ["uploaded", "clean"])
        assert.equal(
          (
            await service("advance_evidence_artifact", {
              p_artifact_id: id,
              p_state: state,
              p_sha256: "b".repeat(64),
              p_size: 128,
            })
          ).status,
          200
        );
    }
    const body = {
      p_case: caseId,
      p_expected_version: Number(
        sql(`select version from private.evidence_cases where id='${caseId}';`)
      ),
      p_id_artifact: artifacts[0],
      p_selfie_artifact: artifacts[1],
      p_fingerprint: fingerprint,
      p_identity_key: processed.identityKeyId,
      p_encrypted_number: processed.encryptedNumber,
      p_receipt: randomUUID(),
      p_risk_score: risk,
    };
    const registered = await service("register_identity_submission", body);
    assert.equal(registered.status, 200);
    return {
      owner,
      caseId,
      artifacts,
      fingerprint,
      body,
      number,
      id: registered.data.submission_id,
      version: registered.data.case_version,
    };
  };
  const claim = async (submission, reviewer = staff.governorB) => {
    const result = await rpc(
      "claim_evidence_case",
      { p_case_id: submission.caseId },
      reviewer.token
    );
    assert.equal(result.status, 200);
    return result.data;
  };
  const review = (submission, lease, reviewer = staff.governorB, extra = {}) =>
    rpc(
      "review_identity_submission",
      {
        p_submission: submission.id,
        p_expected_version: submission.version,
        p_claim_generation: lease.claim_generation,
        p_claim_nonce: lease.claim_nonce,
        p_number_matches: true,
        p_selfie_matches: true,
        ...extra,
      },
      reviewer.token
    );
  const phone = async (owner, suffix, locality = true) => {
    const body = {
      p_owner: owner.id,
      p_phone: `+2770000${suffix}`,
      p_hash: randomBytes(64).toString("hex"),
    };
    const created = await service("create_verification_phone_challenge", body);
    assert.equal(created.status, 200);
    const args = { p_owner: owner.id, p_challenge: created.data.challenge_id };
    assert.equal(
      (await service("finalize_verification_phone", { ...args, p_expected_hash: body.p_hash }))
        .status,
      400
    );
    const attempt = await service("claim_verification_phone_attempt", args);
    assert.equal(attempt.status, 200);
    assert.equal(attempt.data.otp_hash, body.p_hash);
    assert.equal(
      (await service("finalize_verification_phone", { ...args, p_expected_hash: "x".repeat(20) }))
        .status,
      400
    );
    const result = await service("finalize_verification_phone", {
      ...args,
      p_expected_hash: body.p_hash,
    });
    assert.equal(result.status, 200);
    sql(
      `update private.verification_phone_challenges set expires_at=created_at+interval '1 microsecond' where id='${args.p_challenge}';`
    );
    assert.equal(
      (await service("finalize_verification_phone", { ...args, p_expected_hash: body.p_hash })).data
        .reused,
      true
    );
    if (locality)
      assert.equal(
        (
          await rpc(
            "confirm_verification_locality",
            { p_province: "gp", p_city: "gp_johannesburg" },
            owner.token
          )
        ).status,
        200
      );
    return result.data.proof_id;
  };

  stage("trusted verification processing and owner boundaries");
  const a = await createUser("identity-a"),
    b = await createUser("identity-b");
  assert.equal((await trial(a)).status, 403);
  const first = await prepare(a);
  assert.equal((await rpc("register_identity_submission", first.body, a.token)).status, 403);
  assert.equal(
    (await rpc("grant_verified_intro_trial", { p_owner: a.id, p_days: 7 }, a.token)).status,
    403
  );
  assert.equal((await service("register_identity_submission", first.body)).data.reused, true);
  for (const patch of [
    { p_risk_score: 90 },
    { p_fingerprint: sourceIdentityDigestToFingerprint(randomBytes(32).toString("hex")) },
  ])
    assert.equal(
      (await service("register_identity_submission", { ...first.body, ...patch })).status,
      409
    );
  assert.equal(
    (
      await service("register_identity_submission", {
        ...first.body,
        p_receipt: randomUUID(),
        p_encrypted_number: { ...first.body.p_encrypted_number, iv: null },
      })
    ).status,
    400
  );
  assert.equal((await trial(a)).status, 403);
  const lease = await claim(first);
  const contextArgs = {
    p_case: first.caseId,
    p_claim_generation: lease.claim_generation,
    p_claim_nonce: lease.claim_nonce,
  };
  assert.equal(
    (await rpc("staff_identity_review_context", contextArgs, staff.admin.token)).status,
    403
  );
  await assert.rejects(
    () =>
      readStaffIdentityContext(authenticated(staff.admin), {
        case_id: first.caseId,
        claim_generation: lease.claim_generation,
        claim_nonce: lease.claim_nonce,
      }),
    /^Error: Foundation identity review unavailable$/
  );
  const context = {
    status: 200,
    data: await readStaffIdentityContext(authenticated(staff.governorB), {
      case_id: first.caseId,
      claim_generation: lease.claim_generation,
      claim_nonce: lease.claim_nonce,
    }),
  };
  assert.equal(context.status, 200);
  assert.equal(context.data.submission_id, first.id);
  for (const forbidden of [
    "identity_hmac",
    "number_ciphertext",
    "number_iv",
    "number_tag",
    "object_key",
  ])
    assert.equal(Object.hasOwn(context.data, forbidden), false);
  record("native-typed-staff-identity-context-caller-jwt-and-exact-dto");
  for (const who of [a, { ...staff.governorB, token: staff.governorB.aal1 }, staff.admin])
    assert.equal((await review(first, lease, who)).status, 403);
  assert.equal(
    (await review(first, lease, staff.governorB, { p_number_matches: false })).status,
    400
  );
  assert.equal(
    (await review(first, lease, staff.governorB, { p_selfie_matches: false })).status,
    400
  );
  assert.equal((await review(first, { ...lease, claim_nonce: randomUUID() })).status, 403);
  const accepted = await review(first, lease);
  assert.equal(accepted.status, 200);
  assert.equal((await review(first, lease)).data.reused, true);
  assert.equal((await trial(a)).status, 403); // ID/selfie alone is not complete verification.
  const proof = await phone(a, "1001");
  assert.equal((await trial(a)).data.granted, true);
  assert.equal((await trial(a)).data.reason, "identity_already_used");
  sqlFails(
    `begin;set local role service_role; select internal.grant_intro_trial('${a.id}','${first.fingerprint}',7);rollback;`,
    "42501"
  );
  sqlFails(
    `update private.accepted_identity_facts set identity_hmac='${"A".repeat(43)}' where owner_id='${a.id}';`,
    "23514"
  );
  assert.equal(
    sql(
      `select count(*) from private.outbox_events where kind='identity_accepted' and owner_id='${a.id}';`
    ),
    "1"
  );
  record("native-trusted-identity-receipt-independent-review-and-derived-trial");

  stage("approved identity/locality and account trial history");
  const finalized = await rpc("open_verification_case", {}, a.token);
  assert.equal(finalized.status, 200);
  assert.equal(finalized.data.case_id, first.caseId);
  assert.equal(finalized.data.read_only, true);
  for (const purpose of ["id_front", "selfie"])
    assert.equal(
      (await rpc("begin_evidence_upload", { p_case_id: first.caseId, p_purpose: purpose }, a.token))
        .status,
      409
    );
  assert.equal(
    (await service("register_identity_submission", { ...first.body, p_receipt: randomUUID() }))
      .status,
    409
  );
  const localityBefore = sql(
    `select row_to_json(l)::text from private.verification_localities l where owner_id='${a.id}';`
  );
  assert.equal(
    (
      await rpc(
        "confirm_verification_locality",
        { p_province: "gp", p_city: "gp_johannesburg" },
        a.token
      )
    ).data.reused,
    true
  );
  assert.equal(
    (
      await rpc(
        "confirm_verification_locality",
        { p_province: "wc", p_city: "wc_cape_town" },
        a.token
      )
    ).status,
    409
  );
  assert.equal(
    sql(
      `select row_to_json(l)::text from private.verification_localities l where owner_id='${a.id}';`
    ),
    localityBefore
  );
  const alternateHistory = sourceIdentityDigestToFingerprint(randomBytes(32).toString("hex"));
  const trialCount = sql(
    `select count(*) from private.entitlements where owner_id='${a.id}' and source='intro_trial';`
  );
  sql(
    `update private.trial_identities set identity_hmac='${alternateHistory}' where owner_id='${a.id}';`
  );
  try {
    assert.equal((await trial(a)).data.reason, "account_already_used");
    assert.equal(
      sql(
        `select count(*) from private.entitlements where owner_id='${a.id}' and source='intro_trial';`
      ),
      trialCount
    );
  } finally {
    sql(
      `update private.trial_identities set identity_hmac='${first.fingerprint}' where owner_id='${a.id}';`
    );
  }
  record("native-verification-approved-input-locks-and-account-trial-history");

  stage("trusted duplicate identity and high-risk review");
  const duplicate = await prepare(b, 10, first.number);
  assert.equal((await review(duplicate, await claim(duplicate))).status, 409);
  const highOwners = [];
  for (const [label, approver] of [
    ["high-governor", staff.governorC],
    ["high-admin", staff.admin],
  ]) {
    const owner = await createUser(label),
      submission = await prepare(owner, 90),
      claimData = await claim(submission);
    highOwners.push(owner);
    const proposal = await review(submission, claimData);
    assert.equal(proposal.status, 200);
    assert.equal(proposal.data.status, "awaiting_second_reviewer");
    const args = { p_decision_id: proposal.data.decision_id };
    assert.equal((await rpc("approve_decision", args, staff.governorB.token)).status, 403);
    assert.equal((await rpc("approve_decision", args, owner.token)).status, 403);
    assert.equal((await rpc("approve_decision", args, approver.token)).status, 200);
    assert.equal(
      sql(
        `select second_reviewer='${approver.id}' from private.accepted_identity_facts where owner_id='${owner.id}';`
      ),
      "t"
    );
  }
  record("native-trusted-identity-duplicate-and-explicit-two-person-capabilities");
  const raceNumber = nextNumber(),
    raceOne = await prepare(await createUser("identity-race-a"), 10, raceNumber),
    raceTwo = await prepare(await createUser("identity-race-b"), 10, raceNumber);
  const raceLeases = await Promise.all([claim(raceOne), claim(raceTwo)]);
  const raceResults = await Promise.all([
    review(raceOne, raceLeases[0]),
    review(raceTwo, raceLeases[1]),
  ]);
  assert.deepEqual(raceResults.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    sql(
      `select count(*) from private.accepted_identity_facts where identity_hmac='${raceOne.fingerprint}' and revoked_at is null;`
    ),
    "1"
  );
  record("native-trusted-identity-concurrent-duplicate-approval-is-atomic");

  stage("actual contact-change clock and composed readiness");
  const contactOwner = highOwners[0];
  const originalProof = await phone(contactOwner, "1002", false);
  sql(
    `update private.verification_phone_proofs set contact_changed_at=clock_timestamp()-interval '16 days' where id='${originalProof}';`
  );
  const clockBefore = sql(
    `select contact_changed_at from private.verification_phone_proofs where id='${originalProof}';`
  );
  const changeHash = randomBytes(64).toString("hex");
  const change = await service("create_verification_phone_challenge", {
    p_owner: contactOwner.id,
    p_phone: "+27700001003",
    p_hash: changeHash,
  });
  assert.equal(change.status, 200);
  assert.equal(
    (
      await service("claim_verification_phone_attempt", {
        p_owner: contactOwner.id,
        p_challenge: change.data.challenge_id,
      })
    ).status,
    200
  );
  assert.equal(
    (
      await service("finalize_verification_phone", {
        p_owner: contactOwner.id,
        p_challenge: change.data.challenge_id,
        p_expected_hash: changeHash,
      })
    ).status,
    409
  );
  const reproof = await phone(contactOwner, "1002");
  assert.equal(
    sql(`select contact_changed_at from private.verification_phone_proofs where id='${reproof}';`),
    clockBefore
  );
  assert.equal((await trial(contactOwner)).data.granted, true);
  record("native-verification-phone-reproof-preserves-change-clock-and-full-readiness");

  stage("unapproved receipt replacement and pending high-risk fences");
  const replacedOwner = await createUser("replacement"),
    replaced = await prepare(replacedOwner, 90);
  const replacementProcessing = processIdentityNumber(replacedOwner.id, nextNumber(), keys);
  const replacement = await service("register_identity_submission", {
    ...replaced.body,
    p_expected_version: replaced.version,
    p_receipt: randomUUID(),
    p_fingerprint: replacementProcessing.fingerprint,
    p_encrypted_number: replacementProcessing.encryptedNumber,
  });
  assert.equal(replacement.status, 200);
  const replacedLease = await claim(replaced);
  assert.equal((await review(replaced, replacedLease)).status, 409);
  const currentReplacement = {
    ...replaced,
    id: replacement.data.submission_id,
    version: replacement.data.case_version,
  };
  const replacementProposal = await review(currentReplacement, replacedLease);
  assert.equal(replacementProposal.status, 200);
  assert.equal(
    (
      await service("register_identity_submission", {
        ...replaced.body,
        p_expected_version: currentReplacement.version,
        p_receipt: randomUUID(),
      })
    ).status,
    409
  );
  assert.equal(
    (
      await rpc(
        "begin_evidence_upload",
        { p_case_id: replaced.caseId, p_purpose: "selfie" },
        replacedOwner.token
      )
    ).status,
    409
  );
  assert.equal(
    (
      await rpc(
        "approve_decision",
        { p_decision_id: replacementProposal.data.decision_id },
        staff.governorC.token
      )
    ).status,
    200
  );
  assert.equal(
    sql(
      `select count(*) from private.accepted_identity_facts where owner_id='${replacedOwner.id}' and submission_id='${currentReplacement.id}';`
    ),
    "1"
  );
  record("native-trusted-identity-unapproved-replacement-and-pending-override-fences");

  stage("claim expiry after identity serialization wait");
  const waitedOwner = await createUser("waited"),
    waited = await prepare(waitedOwner),
    waitedClaim = await claim(waited);
  sql(
    `update private.evidence_cases set claim_expires_at=clock_timestamp()+interval '2 seconds' where id='${waited.caseId}';`
  );
  const barrier = controlledSql(
    `begin;select pg_advisory_xact_lock(hashtextextended('${waited.fingerprint}',2701));select 'EVIDENCE_LOCK_HELD';select pg_sleep(3);commit;`
  );
  try {
    await barrier.barrier;
    const pending = review(waited, waitedClaim);
    await awaitQueuedRpc("review_identity_submission");
    assert.equal(await barrier.done, 0);
    assert.equal((await pending).status, 403);
  } finally {
    barrier.close();
  }
  assert.equal(
    sql(`select count(*) from private.accepted_identity_facts where owner_id='${waitedOwner.id}';`),
    "0"
  );
  record("native-trusted-identity-claim-expiry-after-fingerprint-wait-no-effects");

  stage("staff-started decision-bound identity ban and closure");
  for (const who of [a, staff.admin, staff.moderator])
    assert.equal((await history(a, who)).status, 403);
  assert.equal((await service("staff_identity_history", { p_owner: a.id })).status, 403);
  for (const who of [
    a,
    staff.admin,
    staff.moderator,
    { ...staff.governorB, token: staff.governorB.aal1 },
  ])
    await assert.rejects(
      () => typedHistory(a, who),
      /^Error: Foundation identity history unavailable$/
    );
  const discovered = await typedHistory(a);
  assert.equal(discovered.status, 200);
  assert.equal(discovered.data.identities.length, 1);
  assert.equal(discovered.data.identities[0].identity_fact_id, accepted.data.identity_fact_id);
  assert.equal(JSON.stringify(discovered.data).includes(first.fingerprint), false);
  for (const forbidden of ["identity_hmac", "number_ciphertext", "object_key"])
    assert.equal(JSON.stringify(discovered.data).includes(forbidden), false);
  // Pagination-only historical metadata fixtures. Trusted approval commands were
  // exercised above; these revoked copies grant no verification or trial rights.
  sql(`do $history$ declare original private.verification_identity_submissions; copied uuid; reviewed timestamptz; begin
    select s.* into original from private.verification_identity_submissions s where s.id='${first.id}';
    select f.reviewed_at into reviewed from private.accepted_identity_facts f where f.id='${accepted.data.identity_fact_id}';
    for n in 1..20 loop
      insert into private.verification_identity_submissions(case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,receipt_id,recipe,risk_score)
      values(original.case_id,original.owner_id,original.case_version,original.id_artifact_id,original.selfie_artifact_id,original.identity_hmac,original.identity_key_id,original.number_ciphertext,original.number_iv,original.number_tag,original.encryption_key_id,gen_random_uuid(),original.recipe,original.risk_score) returning id into copied;
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,reviewed_at,revoked_at)
      values(original.owner_id,copied,original.identity_hmac,'${staff.governorB.id}',reviewed-make_interval(secs=>n),clock_timestamp());
    end loop;end $history$;`);
  const page1 = await typedHistory(a);
  assert.equal(page1.status, 200);
  assert.equal(page1.data.identities.length, 20);
  assert.ok(page1.data.next_cursor);
  const page2 = await typedHistory(a, staff.governorB, page1.data.next_cursor);
  assert.equal(page2.status, 200);
  assert.equal(page2.data.identities.length, 1);
  assert.equal(page2.data.next_cursor, null);
  assert.equal(
    new Set([...page1.data.identities, ...page2.data.identities].map((x) => x.identity_fact_id))
      .size,
    21
  );
  assert.equal(
    sql(
      `select identity_fact_ids=array['${page2.data.identities[0].identity_fact_id}']::uuid[] from private.evidence_access_log where case_id='${page2.data.case_id}' order by accessed_at desc,id desc limit 1;`
    ),
    "t"
  );
  sql(
    `update private.evidence_cases set claim_expires_at=clock_timestamp()-interval '1 second' where id='${page2.data.case_id}';`
  );
  const rotatedHistory = await typedHistory(a);
  assert.equal(rotatedHistory.status, 200);
  assert.equal(rotatedHistory.data.case_id, page2.data.case_id);
  assert.equal(
    BigInt(rotatedHistory.data.claim_generation),
    BigInt(page2.data.claim_generation) + 1n
  );
  assert.notEqual(rotatedHistory.data.claim_nonce, page2.data.claim_nonce);
  assert.equal(
    (
      await rpc(
        "renew_evidence_claim",
        {
          p_case_id: page2.data.case_id,
          p_claim_generation: page2.data.claim_generation,
          p_claim_nonce: page2.data.claim_nonce,
        },
        staff.governorB.token
      )
    ).status,
    403
  );
  assert.equal(
    (await history(a, staff.governorB, { p_before_time: page1.data.identities[0].reviewed_at }))
      .status,
    400
  );
  record("native-trusted-identity-history-http-pagination-exact-audit-and-fencing");
  stage("typed staff history initial role tuple");
  const activeRoleId = sql(
    `select id from private.staff_roles where user_id='${staff.governorB.id}' and revoked_at is null;`
  );
  assert.match(activeRoleId, /^[a-f0-9-]{36}$/);
  stage("typed staff history revoked-role denial");
  try {
    sql(
      `update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='${staff.admin.id}' where id='${activeRoleId}' and user_id='${staff.governorB.id}';`
    );
    await assert.rejects(() => typedHistory(a), /^Error: Foundation identity history unavailable$/);
  } finally {
    sql(
      `update private.staff_roles set revoked_at=null,revoked_by=null where id='${activeRoleId}' and user_id='${staff.governorB.id}';`
    );
  }
  const staffSessionId = JSON.parse(
    Buffer.from(staff.governorB.token.split(".")[1], "base64url").toString("utf8")
  ).session_id;
  assert.match(staffSessionId, /^[a-f0-9-]{36}$/);
  stage("typed staff history original session lifetime");
  assert.equal(
    sql(
      `select count(*) from auth.sessions where id='${staffSessionId}' and user_id='${staff.governorB.id}';`
    ),
    "1"
  );
  // Preserve the real fixture session lifetime rather than assuming NULL. Other
  // session tests/GoTrue policies may legitimately use a bounded future clock.
  const previousSessionExpiry = sql(
    `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${staffSessionId}';`
  );
  stage("typed staff history expired-session denial");
  try {
    sql(
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${staffSessionId}';`
    );
    await assert.rejects(() => typedHistory(a), /^Error: Foundation identity history unavailable$/);
  } finally {
    sql(
      `update auth.sessions set not_after=${previousSessionExpiry} where id='${staffSessionId}' and user_id='${staff.governorB.id}';`
    );
  }
  record("native-typed-staff-history-current-role-and-session-expiry-denied");

  const closedPayloadCase = {
    case_id: discovered.data.case_id,
    version: discovered.data.case_version,
  };
  assert.equal(
    (
      await rpc(
        "propose_decision",
        {
          p_case_id: closedPayloadCase.case_id,
          p_expected_version: closedPayloadCase.version,
          p_action: "restrict_account",
          p_payload: {
            identity_fact_id: accepted.data.identity_fact_id,
            identity_ban_category: "fraud",
            identity_hmac: first.fingerprint,
          },
        },
        staff.governorB.token
      )
    ).status,
    400
  );
  assert.equal(
    sql(`select count(*) from private.decisions where case_id='${closedPayloadCase.case_id}';`),
    "0"
  );
  const request = {
    p_owner: a.id,
    p_fact: discovered.data.identities[0].identity_fact_id,
    p_category: "fraud",
    p_request: randomUUID(),
  };
  assert.equal((await rpc("propose_verified_identity_ban", request, a.token)).status, 403);
  assert.equal(
    (
      await rpc(
        "propose_verified_identity_ban",
        { ...request, p_owner: b.id },
        staff.governorB.token
      )
    ).status,
    400
  );
  const proposal = await rpc("propose_verified_identity_ban", request, staff.governorB.token);
  assert.equal(proposal.status, 200);
  assert.equal(
    (await rpc("propose_verified_identity_ban", request, staff.governorB.token)).data.decision_id,
    proposal.data.decision_id
  );
  const staffCase = sql(
    `select case_id from private.decisions where id='${proposal.data.decision_id}';`
  );
  assert.equal(
    (await rpc("begin_evidence_upload", { p_case_id: staffCase, p_purpose: "id_front" }, a.token))
      .status,
    400
  );
  const ownerCase = await rpc("open_verification_case", {}, a.token);
  assert.equal(ownerCase.status, 200);
  assert.notEqual(ownerCase.data.case_id, staffCase);
  const subjectBarrier = controlledSql(
    `begin;select pg_advisory_xact_lock(hashtextextended('${a.id}',2408));select 'EVIDENCE_LOCK_HELD';select pg_sleep(3);commit;`
  );
  try {
    await subjectBarrier.barrier;
    const uploadFirst = rpc(
      "begin_evidence_upload",
      { p_case_id: ownerCase.data.case_id, p_purpose: "id_front" },
      a.token
    );
    await awaitQueuedRpc("begin_evidence_upload");
    const approveSecond = rpc(
      "approve_decision",
      { p_decision_id: proposal.data.decision_id },
      staff.governorC.token
    );
    await awaitQueuedRpc("approve_decision");
    assert.equal(await subjectBarrier.done, 0);
    assert.equal((await uploadFirst).status, 409);
    assert.equal((await approveSecond).status, 200);
  } finally {
    subjectBarrier.close();
  }
  assert.equal(
    sql(
      `select revoked_at is null from private.accepted_identity_facts where id='${accepted.data.identity_fact_id}';`
    ),
    "t"
  );
  const reconciled = await service("reconcile_verified_identity_ban", {
    p_decision: proposal.data.decision_id,
  });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.banned, true);
  assert.equal((await trial(a)).status, 403);
  assert.equal(
    (await rpc("propose_verified_identity_ban", request, staff.governorB.token)).data.decision_id,
    proposal.data.decision_id
  );
  assert.equal((await service("close_account_evidence", { p_user_id: a.id })).status, 200);
  assert.equal(
    sql(
      `select revoked_at is not null from private.verification_phone_proofs where id='${proof}';`
    ),
    "t"
  );
  assert.equal((await review(duplicate, await claim(duplicate))).status, 403); // Active ban blocks accepted identity on a new account.
  assert.equal(
    (await service("reconcile_verified_identity_ban", { p_decision: proposal.data.decision_id }))
      .data.retain_until,
    reconciled.data.retain_until
  );
  sql(
    `update private.identity_ban_bindings set approved_at=approved_at-interval '5 years 1 day',retain_until=retain_until-interval '5 years 1 day' where decision_id='${proposal.data.decision_id}'; update private.banned_identities set banned_at=banned_at-interval '5 years 1 day',retain_until=retain_until-interval '5 years 1 day' where decision_id='${proposal.data.decision_id}';`
  );
  assert.equal((await service("purge_expired_identity_bans", { p_limit: 100 })).status, 200);
  assert.equal(
    sql(
      `select count(*) from private.identity_ban_bindings where decision_id='${proposal.data.decision_id}';`
    ),
    "0"
  );
  assert.equal(
    (await service("reconcile_verified_identity_ban", { p_decision: proposal.data.decision_id }))
      .status,
    403
  );
  record("native-trusted-identity-ban-noncooperative-subject-binding-and-copy-purge");

  stage("staff restriction survives approval-first owner upload and closure-first approval");
  const reverseOwner = highOwners[1],
    reverseCase = await rpc("open_verification_case", {}, reverseOwner.token);
  const reverseHistory = await history(reverseOwner);
  assert.equal(reverseHistory.status, 200);
  assert.equal(reverseHistory.data.identities.length, 1);
  const reverseFact = reverseHistory.data.identities[0].identity_fact_id;
  const reverseProposal = await rpc(
    "propose_verified_identity_ban",
    { p_owner: reverseOwner.id, p_fact: reverseFact, p_category: "fraud", p_request: randomUUID() },
    staff.governorB.token
  );
  assert.equal(reverseProposal.status, 200);
  const reverseBarrier = controlledSql(
    `begin;select pg_advisory_xact_lock(hashtextextended('${reverseOwner.id}',2408));select 'EVIDENCE_LOCK_HELD';select pg_sleep(3);commit;`
  );
  try {
    await reverseBarrier.barrier;
    const approval = rpc(
      "approve_decision",
      { p_decision_id: reverseProposal.data.decision_id },
      staff.governorC.token
    );
    await awaitQueuedRpc("approve_decision");
    const upload = rpc(
      "begin_evidence_upload",
      { p_case_id: reverseCase.data.case_id, p_purpose: "id_front" },
      reverseOwner.token
    );
    await awaitQueuedRpc("begin_evidence_upload");
    assert.equal(await reverseBarrier.done, 0);
    assert.equal((await approval).status, 200);
    assert.equal((await upload).status, 403);
  } finally {
    reverseBarrier.close();
  }
  const winnerIndex = raceResults[0].status === 200 ? 0 : 1;
  const closeOwner = winnerIndex === 0 ? raceOne.owner : raceTwo.owner;
  const closeProposal = await rpc(
    "propose_verified_identity_ban",
    {
      p_owner: closeOwner.id,
      p_fact: raceResults[winnerIndex].data.identity_fact_id,
      p_category: "fraud",
      p_request: randomUUID(),
    },
    staff.governorB.token
  );
  assert.equal(closeProposal.status, 200);
  const closeBarrier = controlledSql(
    `begin;select pg_advisory_xact_lock(hashtextextended('${closeOwner.id}',2408));select 'EVIDENCE_LOCK_HELD';select pg_sleep(3);commit;`
  );
  try {
    await closeBarrier.barrier;
    const closure = service("close_account_evidence", { p_user_id: closeOwner.id });
    await awaitQueuedRpc("close_account_evidence");
    const approval = rpc(
      "approve_decision",
      { p_decision_id: closeProposal.data.decision_id },
      staff.governorC.token
    );
    await awaitQueuedRpc("approve_decision");
    assert.equal(await closeBarrier.done, 0);
    assert.equal((await closure).status, 200);
    assert.equal((await approval).status, 200);
  } finally {
    closeBarrier.close();
  }
  assert.equal(
    sql(
      `select count(*) from private.identity_ban_bindings where decision_id='${closeProposal.data.decision_id}';`
    ),
    "1"
  );
  record("native-identity-ban-staff-case-survives-owner-upload-and-closure-races");
}

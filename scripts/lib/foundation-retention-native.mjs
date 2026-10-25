import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createPostingVerifier,
  createTrustedPostingFixture,
} from "./foundation-trusted-posting-fixture.mjs";

const uuid = (value) => {
  assert.match(value, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  return value;
};

// Synthetic local proof of DEC-35: ID files go 30 days after the decision
// unless a fraud hold is open, verification survives that deletion, and every
// other kind of personal data is removed by the daily sweep at its period.
// Rows are aged by direct harness SQL; guarded tables are aged with their
// guard disabled only inside the harness transaction.
export async function testRetention({
  createUser,
  rpc,
  sql,
  sqlFails,
  record,
  fixtureAdminId,
  stage,
}) {
  stage("retention reviewers and verified owners");
  const reviewer = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId,
    label: "retention-reviewer",
  });
  const governor = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId,
    label: "retention-fraud-governor",
  });
  const moderator = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId,
    role: "moderator",
    label: "retention-moderator",
  });
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const owner = await createUser("retention-owner");
  const ready = await fixture.ready(owner);
  const service = async (name, body) => {
    const response = await rpc(name, body, null, true);
    assert.equal(response.status, 200, "retention fixture " + name);
    return response.data;
  };
  const staffCall = async (who, name, body) => {
    await who.refresh();
    return rpc(name, body, who.token);
  };
  const verified = (user) =>
    sql("select internal.current_verified_identity('" + uuid(user.id) + "') is not null;");
  const caseVersion = (caseId) =>
    sql("select version from private.evidence_cases where id='" + uuid(caseId) + "';");
  const artifactsOf = (caseId) =>
    sql(
      "select string_agg(id::text,',' order by id) from private.evidence_artifacts where case_id='" +
        uuid(caseId) +
        "';"
    ).split(",");
  const sweep = () => service("run_retention", { p_limit: 500 });
  const count = (statement) => Number(sql(statement));

  stage("retention decision starts the 30-day clock");
  assert.equal(
    sql(
      "select string_agg(round(extract(epoch from retain_until-statement_timestamp())/86400)::text,',') from private.evidence_artifacts where case_id='" +
        ready.caseId +
        "';"
    ),
    "30,30"
  );
  assert.equal(verified(owner), "t");
  record("native-retention-decision-sets-30-day-deadline-on-reviewed-files");

  stage("retention fraud hold capability and idempotence");
  const holdBody = { p_case_id: ready.caseId, p_reason: "Synthetic fraud investigation" };
  const moderatorHold = await staffCall(moderator, "place_evidence_fraud_hold", holdBody);
  assert.equal(moderatorHold.status, 403);
  assert.equal(moderatorHold.data.message, "capability not granted");
  assert.equal((await rpc("place_evidence_fraud_hold", holdBody, owner.token)).status, 403);
  assert.equal((await rpc("place_evidence_fraud_hold", holdBody, null)).status, 401);
  assert.equal(
    (
      await staffCall(governor, "place_evidence_fraud_hold", {
        ...holdBody,
        p_reason: "hidden" + String.fromCharCode(0x202e) + "mark",
      })
    ).status,
    400
  );
  const placed = await staffCall(governor, "place_evidence_fraud_hold", holdBody);
  assert.equal(placed.status, 200);
  assert.equal(placed.data.reused, false);
  assert.equal(placed.data.retained_artifacts, 2);
  const again = await staffCall(governor, "place_evidence_fraud_hold", holdBody);
  assert.equal(again.data.hold_id, placed.data.hold_id);
  assert.equal(again.data.reused, true);
  sqlFails(
    "update private.evidence_fraud_holds set reason='Rewritten reason text' where id='" +
      uuid(placed.data.hold_id) +
      "';",
    "23514"
  );
  record("native-retention-fraud-hold-governor-only-idempotent-immutable");

  stage("retention fraud hold keeps due evidence and the identity number");
  const files = artifactsOf(ready.caseId);
  sql(
    "update private.evidence_artifacts set retain_until=statement_timestamp()-interval '1 second' where case_id='" +
      ready.caseId +
      "';"
  );
  const heldClaim = await service("claim_evidence_cleanup", { p_limit: 100 });
  assert.equal(
    heldClaim.some((row) => files.includes(row.artifact_id)),
    false
  );
  await sweep();
  assert.equal(
    sql(
      "select number_erased_at is null and number_ciphertext is not null from private.verification_identity_submissions where id='" +
        uuid(ready.submissionId) +
        "';"
    ),
    "t"
  );
  record("native-retention-open-fraud-hold-blocks-file-deletion-and-number-erasure");

  stage("retention closing the hold releases the files, verification stays");
  const closeBody = {
    p_case_id: ready.caseId,
    p_hold_id: placed.data.hold_id,
    p_reason: "Investigation closed, no fraud",
  };
  const closed = await staffCall(governor, "close_evidence_fraud_hold", closeBody);
  assert.equal(closed.status, 200);
  assert.equal(closed.data.reused, false);
  assert.equal(
    (await staffCall(governor, "close_evidence_fraud_hold", closeBody)).data.reused,
    true
  );
  assert.equal(
    (
      await staffCall(governor, "close_evidence_fraud_hold", {
        ...closeBody,
        p_reason: "A different closing reason",
      })
    ).status,
    400
  );
  const reopened = await staffCall(governor, "place_evidence_fraud_hold", holdBody);
  assert.equal(reopened.status, 200);
  assert.notEqual(reopened.data.hold_id, placed.data.hold_id);
  assert.equal(
    (await staffCall(governor, "close_evidence_fraud_hold", closeBody)).data.reused,
    true
  );
  assert.equal(
    sql(
      "select closed_at is null from private.evidence_fraud_holds where id='" +
        uuid(reopened.data.hold_id) +
        "';"
    ),
    "t"
  );
  assert.equal(
    (
      await staffCall(governor, "close_evidence_fraud_hold", {
        ...closeBody,
        p_hold_id: reopened.data.hold_id,
      })
    ).status,
    200
  );
  record("native-retention-stale-close-cannot-release-a-new-fraud-hold");
  const versionBefore = caseVersion(ready.caseId);
  const released = await service("claim_evidence_cleanup", { p_limit: 100 });
  assert.deepEqual(
    released
      .map((row) => row.artifact_id)
      .filter((id) => files.includes(id))
      .sort(),
    [...files].sort()
  );
  for (const row of released.filter((row) => files.includes(row.artifact_id))) {
    assert.match(row.claim_token, /^[a-f0-9-]{36}$/);
    await service("mark_evidence_deleted", {
      p_artifact: row.artifact_id,
      p_claim_token: row.claim_token,
    });
  }
  assert.equal(caseVersion(ready.caseId), versionBefore);
  assert.equal(verified(owner), "t");
  assert.equal(
    sql(
      "select revoked_at is null from private.accepted_identity_facts where id='" +
        ready.factId +
        "';"
    ),
    "t"
  );
  record("native-retention-deleted-files-keep-case-version-identity-and-verification");

  stage("retention erases the identity number, nothing else");
  const erased = await sweep();
  assert.ok(erased.verification.identity_numbers_erased >= 1);
  assert.equal(
    sql(
      "select (number_ciphertext is null and number_iv is null and number_tag is null and number_erased_at is not null and identity_hmac is not null)::text from private.verification_identity_submissions where id='" +
        uuid(ready.submissionId) +
        "';"
    ),
    "true"
  );
  assert.equal(verified(owner), "t");
  sqlFails(
    "update private.verification_identity_submissions set risk_score=11 where id='" +
      ready.submissionId +
      "';",
    "23514"
  );
  record("native-retention-number-erased-fingerprint-kept-submission-otherwise-immutable");

  stage("retention cannot hide changed reviewed bytes");
  const changedOwner = await createUser("retention-changed-bytes");
  const changedReady = await fixture.ready(changedOwner);
  const reviewedVersion = caseVersion(changedReady.caseId);
  sqlFails(
    "update private.evidence_artifacts set state='cleanup_required',sha256='" +
      randomBytes(32).toString("hex") +
      "' where id=(select id_artifact_id from private.verification_identity_submissions where id='" +
      uuid(changedReady.submissionId) +
      "');",
    "23514"
  );
  assert.equal(verified(changedOwner), "t");
  sql(
    "update private.evidence_artifacts set state='cleanup_required',size_bytes=size_bytes+1 " +
      "where id=(select id_artifact_id from private.verification_identity_submissions where id='" +
      uuid(changedReady.submissionId) +
      "');"
  );
  assert.ok(Number(caseVersion(changedReady.caseId)) > Number(reviewedVersion));
  assert.equal(verified(changedOwner), "f");
  record("native-retention-retirement-with-changed-bytes-revokes-verification");

  stage("retention closure never extends the decision deadline");
  const closing = await createUser("retention-closing");
  const closingReady = await fixture.ready(closing);
  const closedAccount = await service("close_account_evidence", { p_user_id: closing.id });
  assert.equal(closedAccount.scheduled, 0);
  assert.equal(
    sql(
      "select string_agg(round(extract(epoch from retain_until-statement_timestamp())/86400)::text,',') from private.evidence_artifacts where case_id='" +
        closingReady.caseId +
        "';"
    ),
    "30,30"
  );
  record("native-retention-account-closure-keeps-sooner-decision-deadline");

  stage("retention guards stay closed outside the sweep");
  sql(
    "insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids,accessed_at) values('" +
      reviewer.id +
      "','" +
      closingReady.caseId +
      "','routine_review',1,1,'{}',statement_timestamp()-interval '2 years 1 day');"
  );
  sqlFails(
    "delete from private.evidence_access_log where case_id='" + closingReady.caseId + "';",
    "23514"
  );
  record("native-retention-append-only-guards-refuse-deletes-outside-the-sweep");

  stage("retention closed account details after 30 days, history after 5 years");
  const files2 = artifactsOf(closingReady.caseId);
  sql(
    "update private.account_closures set closed_at=closed_at-interval '31 days',evidence_delete_after=evidence_delete_after-interval '31 days' where user_id='" +
      closing.id +
      "'; update private.evidence_artifacts set retain_until=statement_timestamp()-interval '1 second' where case_id='" +
      closingReady.caseId +
      "';"
  );
  const closedFiles = await service("claim_evidence_cleanup", { p_limit: 100 });
  for (const row of closedFiles.filter((r) => files2.includes(r.artifact_id)))
    await service("mark_evidence_deleted", {
      p_artifact: row.artifact_id,
      p_claim_token: row.claim_token,
    });
  await sweep();
  assert.equal(
    count(
      "select count(*) from private.verification_localities where owner_id='" + closing.id + "';"
    ),
    0
  );
  assert.equal(
    count(
      "select count(*) from private.posting_terms_acceptances where owner_id='" + closing.id + "';"
    ),
    0
  );
  assert.equal(
    count(
      "select count(*) from private.accepted_identity_facts where owner_id='" + closing.id + "';"
    ),
    1
  );
  sql(
    "update private.account_closures set closed_at=closed_at-interval '5 years',evidence_delete_after=evidence_delete_after-interval '5 years' where user_id='" +
      closing.id +
      "';"
  );
  const history = await sweep();
  assert.ok(history.verification.closed_account_verification_histories >= 1);
  assert.equal(
    sql(
      "select concat_ws(':'," +
        [
          "accepted_identity_facts where owner_id",
          "identity_submission_names where owner_id",
          "verification_identity_submissions where owner_id",
          "evidence_artifacts where owner_id",
          "evidence_cases where subject_id",
          "verification_phone_proofs where owner_id",
          "verification_phone_challenges where owner_id",
        ]
          .map((t) => "(select count(*) from private." + t + "='" + closing.id + "')")
          .join(",") +
        ",(select count(*) from private.account_closures where user_id='" +
        closing.id +
        "'),(select count(*) from auth.users where id='" +
        closing.id +
        "'));"
    ),
    "0:0:0:0:0:0:0:1:1"
  );
  record("native-retention-closed-account-details-30-days-history-5-years-closure-kept");

  stage("retention phone codes and revoked proofs");
  const phoneOwner = await createUser("retention-phone");
  const proof = await fixture.phone(phoneOwner);
  await service("create_verification_phone_challenge", {
    p_owner: phoneOwner.id,
    p_phone: proof.phone,
    p_hash: randomBytes(32).toString("hex"),
  });
  const fresh = await service("create_verification_phone_challenge", {
    p_owner: phoneOwner.id,
    p_phone: proof.phone,
    p_hash: randomBytes(32).toString("hex"),
  });
  sql(
    "update private.verification_phone_challenges set created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' where owner_id='" +
      phoneOwner.id +
      "' and id<>'" +
      uuid(fresh.challenge_id) +
      "'; update private.verification_phone_proofs set revoked_at=statement_timestamp()-interval '31 days' where id='" +
      proof.proofId +
      "';"
  );
  await sweep();
  assert.equal(
    sql(
      "select string_agg(id::text,',') from private.verification_phone_challenges where owner_id='" +
        phoneOwner.id +
        "';"
    ),
    fresh.challenge_id
  );
  assert.equal(
    count(
      "select count(*) from private.verification_phone_proofs where owner_id='" +
        phoneOwner.id +
        "';"
    ),
    0
  );
  record("native-retention-phone-codes-24h-after-expiry-revoked-proofs-after-30-days");

  stage("retention staff records, restrictions kept");
  const subject = await createUser("retention-subject");
  const restricted = await createUser("retention-restricted");
  const oldCase = randomUUID(),
    restrictionCase = randomUUID(),
    emptyCase = randomUUID();
  const old = "statement_timestamp()-interval '2 years 1 day'";
  const ancient = "statement_timestamp()-interval '5 years 1 day'";
  sql(
    `insert into private.evidence_cases(id,subject_id,kind,status) values('${oldCase}','${subject.id}','restriction','open'),('${restrictionCase}','${restricted.id}','restriction','open');` +
      `insert into private.evidence_cases(id,subject_id,kind,created_at) values('${emptyCase}','${subject.id}','restriction',${old});` +
      `insert into private.decisions(case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,status,withdrawn_by,withdrawn_at,withdrawn_case_version,withdrawal_reason) values('${oldCase}','reject','{}',1,'[]','${reviewer.id}',${old},'withdrawn','${governor.id}',${old},1,'Synthetic old withdrawal');` +
      `insert into private.decisions(case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,status,approved_by,approved_at) values('${restrictionCase}','restrict_account','{}',1,'[]','${reviewer.id}',${old},'approved','${governor.id}',${old});` +
      `insert into private.moderation_log(post_id,staff_id,decision,post_revision,decided_at) values('${randomUUID()}','${reviewer.id}','approve',1,${old}),('${randomUUID()}','${reviewer.id}','approve',1,statement_timestamp());` +
      `insert into private.queue_claim_events(post_id,actor_id,event,from_staff,claim_generation,reason,created_at) values('${randomUUID()}','${reviewer.id}','released_by_staff','${reviewer.id}',1,'Synthetic release',${old});` +
      `insert into private.reports(subject_account_id,category,description,reporter_ip_hmac,status,resolution_note,resolved_by,resolved_at,created_at) values('${subject.id}','scam','Synthetic old report text','${"a".repeat(43)}','resolved','Synthetic resolution','${reviewer.id}',${old},${old});` +
      `insert into private.staff_roles(user_id,role,granted_by,granted_at,revoked_at,revoked_by) values('${subject.id}','moderator','${fixtureAdminId}',${ancient},${ancient},'${fixtureAdminId}');` +
      `insert into private.legal_holds(subject_id,reason,placed_by,placed_at,released_by,released_at) values('${subject.id}','Synthetic old hold','${fixtureAdminId}',${ancient},'${fixtureAdminId}',${ancient});` +
      `insert into private.evidence_fraud_holds(case_id,reason,placed_by,placed_at,closed_by,closed_at,close_reason) values('${oldCase}','Synthetic old hold','${governor.id}',${old},'${governor.id}',${old},'Synthetic old close');`
  );
  const staffSweep = await sweep();
  assert.equal(
    sql(
      "select concat_ws(':'," +
        `(select count(*) from private.decisions where case_id='${oldCase}'),` +
        `(select count(*) from private.decisions where case_id='${restrictionCase}'),` +
        `(select count(*) from private.evidence_cases where id='${emptyCase}'),` +
        `(select count(*) from private.moderation_log where staff_id='${reviewer.id}' and decided_at<statement_timestamp()-interval '2 years'),` +
        `(select count(*) from private.moderation_log where staff_id='${reviewer.id}'),` +
        `(select count(*) from private.queue_claim_events where actor_id='${reviewer.id}'),` +
        `(select count(*) from private.reports where subject_account_id='${subject.id}'),` +
        `(select count(*) from private.staff_roles where user_id='${subject.id}'),` +
        `(select count(*) from private.legal_holds where subject_id='${subject.id}'),` +
        `(select count(*) from private.evidence_fraud_holds where case_id='${oldCase}'),` +
        `(select count(*) from private.evidence_access_log where case_id='${closingReady.caseId}'));`
    ),
    "0:1:0:0:1:0:0:0:0:0:0"
  );
  assert.ok(staffSweep.staff_records.decisions >= 1);
  assert.equal(
    count(`select count(*) from private.current_account_access where id='${restricted.id}';`),
    0
  );
  record("native-retention-staff-records-2-years-roles-holds-5-years-restrictions-kept");

  stage("retention money records 5 years after the tax year");
  const payer = await createUser("retention-payer");
  const oldPayment = randomUUID(),
    newPayment = randomUUID();
  const sevenYears = "statement_timestamp()-interval '7 years'";
  sql(
    `insert into private.payments(id,owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,created_at,status_changed_at) select '${oldPayment}','${payer.id}','plan',id,100,'ZAR','{}','failed',${sevenYears},${sevenYears} from private.plan_versions order by id limit 1;` +
      `insert into private.payments(id,owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status) select '${newPayment}','${payer.id}','plan',id,100,'ZAR','{}','failed' from private.plan_versions order by id limit 1;` +
      `insert into private.invoices(payment_id,invoice_number,amount_ex_vat_cents,vat_cents,total_cents,description,issued_at) values('${oldPayment}','RET-${randomBytes(4).toString("hex")}',87,13,100,'Synthetic invoice',${sevenYears}),('${newPayment}','RET-${randomBytes(4).toString("hex")}',87,13,100,'Synthetic invoice',statement_timestamp());` +
      `insert into private.provider_events(provider,payload_sha256,merchant_reference,provider_request_id,reported_status,amount_cents,currency,payment_id,outcome,received_at) values('ozow','${randomBytes(32).toString("hex")}','ret-old','ret-old','error',100,'ZAR','${oldPayment}','ignored',${sevenYears});`
  );
  await sweep();
  assert.equal(
    sql(
      `select concat_ws(':',(select count(*) from private.payments where id='${oldPayment}'),(select count(*) from private.payments where id='${newPayment}'),(select count(*) from private.invoices where payment_id in('${oldPayment}','${newPayment}')),(select count(*) from private.provider_events where payment_id='${oldPayment}'));`
    ),
    "0:1:1:0"
  );
  assert.equal(
    sql(
      "select internal.retention_tax_year_due(make_timestamptz(2026,2,27,12,0,0,'Africa/Johannesburg'))::text||':'||internal.retention_tax_year_due(statement_timestamp()-interval '4 years 11 months')::text;"
    ),
    "false:false"
  );
  record("native-retention-payments-invoices-provider-events-5-years-after-tax-year");

  stage("retention sign-in audit, outbox, invites and organisation records");
  const auditOld = randomUUID(),
    auditNew = randomUUID();
  sql(
    `insert into auth.audit_log_entries(instance_id,id,payload,created_at,ip_address) values('00000000-0000-0000-0000-000000000000','${auditOld}','{}',statement_timestamp()-interval '31 days',''),('00000000-0000-0000-0000-000000000000','${auditNew}','{}',statement_timestamp(),'');` +
      `update private.outbox_events set processed_at=statement_timestamp()-interval '31 days' where owner_id='${owner.id}';`
  );
  const org = randomUUID();
  sql(
    `insert into private.organisations(id,slug,name,created_by) values('${org}','retention-${randomBytes(3).toString("hex")}','Retention Synthetic Org','${fixtureAdminId}');` +
      `insert into private.organisation_invites(organisation_id,email,token_hash,invited_by,expires_at,created_at) values('${org}','old-invite@example.test','${randomBytes(32).toString("hex")}','${fixtureAdminId}',statement_timestamp()-interval '31 days',statement_timestamp()-interval '40 days'),('${org}','new-invite@example.test','${randomBytes(32).toString("hex")}','${fixtureAdminId}',statement_timestamp()+interval '7 days',statement_timestamp());` +
      `insert into private.organisation_notes(organisation_id,author_id,note,created_at) values('${org}','${fixtureAdminId}','Synthetic old note',${old});` +
      `insert into private.organisation_events(organisation_id,actor_id,action,created_at) values('${org}','${fixtureAdminId}','synthetic_old',${old}),('${org}','${fixtureAdminId}','synthetic_new',statement_timestamp());`
  );
  const operations = await sweep();
  assert.ok(operations.operations.auth_audit_log >= 1);
  assert.equal(
    sql(
      `select concat_ws(':',(select count(*) from auth.audit_log_entries where id='${auditOld}'),(select count(*) from auth.audit_log_entries where id='${auditNew}'),(select count(*) from private.outbox_events where owner_id='${owner.id}' and processed_at is not null),(select string_agg(email,',') from private.organisation_invites where organisation_id='${org}'),(select count(*) from private.organisation_notes where organisation_id='${org}'),(select string_agg(action,',') from private.organisation_events where organisation_id='${org}'));`
    ),
    "0:1:0:new-invite@example.test:0:synthetic_new"
  );
  sql(
    `delete from auth.audit_log_entries where id='${auditNew}'; delete from private.organisation_invites where organisation_id='${org}'; delete from private.organisation_events where organisation_id='${org}'; delete from private.organisations where id='${org}';`
  );
  record("native-retention-auth-audit-30-days-outbox-invites-organisation-records");

  stage("retention sweep is server-only and bounded");
  assert.equal((await rpc("run_retention", { p_limit: 10 }, owner.token)).status, 403);
  assert.equal((await rpc("run_retention", { p_limit: 0 }, null, true)).status, 400);
  assert.equal(sql("select current_setting('vm.retention',true) is distinct from 'on';"), "t");
  record("native-retention-sweep-service-only-bounded-flag-not-leaked");
}

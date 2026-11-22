#!/usr/bin/env node
// Behaviour checks for 20261122022323_identity_keep_for.sql: how long identity
// check data is kept (accepted identities, accounts closed in good standing,
// banned identities, failed attempts, the partner's copies, authority-request
// logs and the setting's change log), the setting accepting all three values,
// "moved" always going to staff, names at start compared with the submission,
// the cleared start context, the decline reason category and the strict start.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members and staff call as `authenticated` with synthetic claims and a
// live session row; the website's server and the jobs call as `service_role`.
// Time passing is simulated by moving a member's dates back (vmtest.shift). The
// script runs the update's read-only preflight, checks its refusals, applies
// it, checks the rules, and proves apply -> rollback -> apply returns the same
// fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-identity-keep-for.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Every
// person, name, fingerprint, encrypted ID number, session and file receipt is
// synthetic; no object storage and no partner is involved.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertDriftRefused,
  assertReadOnlyPreflight,
  openUpdateCheck,
  sqlJsonb,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261122022323_identity_keep_for.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const REPLACED = [
  "internal.set_identity_check_mode(text,text)",
  "internal.start_my_identity_check()",
  "internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer)",
  "internal.decline_automatic_identity_submission(uuid,uuid)",
  "internal.ask_person_identity_check(uuid,text)",
  "internal.claim_identity_check_deletions(integer)",
  "internal.identity_check_summary(private.identity_checks)",
  "internal.return_identity_submission(uuid,integer,text,uuid,text)",
  "internal.claim_evidence_cleanup(integer)",
  "internal.retention_verification(integer)",
  "internal.evidence_artifact_submission_guard()",
  "internal.get_staff_operations_health()",
];

const opened = await openUpdateCheck(PREFLIGHT);
const { started, database, check, current, q, json, fails, member, staff, service, as, claims } =
  opened;
const { fingerprint, bodyMd5, syntheticMember, passed: checks } = opened;
const preflight = opened.preflightRows;
/** Synthetic identity values: a keyed fingerprint, an encrypted ID number and a file receipt. */
const synthetic = {
  hex: (bytes) => randomBytes(bytes).toString("hex"),
  fingerprint: () =>
    `${createHash("sha256").update(`keep-for-${randomUUID()}`).digest("base64url").slice(0, 42)}Q`,
  number: () => ({
    ciphertext: synthetic.hex(13),
    iv: synthetic.hex(12),
    tag: synthetic.hex(16),
    key_id: "identity-number-v1",
  }),
  receipt: () => ({
    stored_sha256: synthetic.hex(32),
    content_sha256: synthetic.hex(32),
    size: 98765,
  }),
};
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);
  const fp = synthetic.fingerprint;
  const encrypted = synthetic.number;
  const receipt = synthetic.receipt;

  syntheticMember("setup");
  q(`create or replace function vmtest.staff_member(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      if p_role is not null then insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role); end if;
      return m;
    end$$;
    create or replace function vmtest.named_member(p_label text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      perform set_config('session_replication_role','replica',true);
      insert into private.profiles(account_id) values((m->>'id')::uuid) on conflict(account_id) do nothing;
      update private.profiles set legal_first_name='Thando Sipho',legal_last_name='Dlamini' where account_id=(m->>'id')::uuid;
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
        values((m->>'id')::uuid,gen_random_uuid(),'+2783'||lpad((floor(random()*1e7))::bigint::text,7,'0'));
      perform set_config('session_replication_role','origin',true);
      return m;
    end$$;
    -- Moves every identity date of a member back by p_by, as if that time had
    -- passed (owner only; guards are off while it runs).
    create or replace function vmtest.shift(p_user uuid,p_by interval) returns void language plpgsql as $$
    begin
      perform set_config('session_replication_role','replica',true);
      update private.account_closures set closed_at=closed_at-p_by,evidence_delete_after=evidence_delete_after-p_by
        where user_id=p_user;
      update private.evidence_artifacts set created_at=created_at-p_by,retain_until=retain_until-p_by where owner_id=p_user;
      update private.accepted_identity_facts set reviewed_at=reviewed_at-p_by where owner_id=p_user;
      update private.verification_phone_proofs set revoked_at=revoked_at-p_by where owner_id=p_user;
      update private.identity_checks set created_at=created_at-p_by,expires_at=expires_at-p_by,
        finished_at=finished_at-p_by,declined_at=declined_at-p_by,asked_at=asked_at-p_by,
        provider_delete_due=provider_delete_due-p_by,provider_deleted_at=provider_deleted_at-p_by where owner_id=p_user;
      update private.banned_identities set banned_at=banned_at-p_by,retain_until=retain_until-p_by
        where identity_hmac in(select identity_hmac from private.verification_identity_submissions where owner_id=p_user);
      perform set_config('session_replication_role','origin',true);
    end$$;`);
  const staffMember = (label, role) =>
    json(`select vmtest.staff_member(${sqlLiteral(label)},${role ? sqlLiteral(role) : "null"});`);
  const namedMember = (label) => json(`select vmtest.named_member(${sqlLiteral(label)});`);
  const shift = (who, interval) => q(`select vmtest.shift('${who.id}','${interval}');`);

  // ------------------------------------------------------------ before
  await check("before the update: the replaced functions are the reviewed bodies", () => {
    for (const sig of REPLACED) assert.notEqual(bodyMd5(sig), "missing", sig);
    assert.equal(bodyMd5("internal.identity_record_kept(uuid)"), "missing");
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^identity keep-for: update not applied; mode: manual; checks: \d+; finished: \d+; accepted identities: \d+$/
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () =>
    assertDriftRefused(
      { q, fails, fingerprint, preflightRows: preflight },
      {
        rollback: ROLLBACK,
        updateSql: step.sql,
        signatures: REPLACED,
        drift: /identity keep-for drift/,
      }
    )
  );

  // ------------------------------------------------------------- apply
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "identity keep-for",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^identity keep-for: already applied; mode: manual; checks: 0; finished: 0; accepted identities: \d+$/,
  });

  const admin = staffMember("admin", "admin");
  const moderator = staffMember("moderator", "moderator");

  const availability = (who) => json(member(who, "select api.get_identity_check_availability();"));
  const start = (who) => json(member(who, "select api.start_my_identity_check();"));
  const setMode = (mode, reason = "Owner decision for automatic ID checks.") =>
    json(staff(admin, `select api.set_identity_check_mode('${mode}',${sqlLiteral(reason)});`));
  const checkRow = (id) =>
    json(`select to_jsonb(k) from private.identity_checks k where k.id='${id}';`);
  const NET = createHash("sha256").update("synthetic network").digest("hex");
  const startWithSession = (who) => {
    const begun = start(who);
    const session = randomUUID();
    json(
      service(
        `select api.attach_identity_check_session('${begun.check_id}','${session}','https://verify.didit.me/session/${session}','${NET}','phone');`
      )
    );
    return { check: begun.check_id, session };
  };
  const TYPED = { first_name: "Thando Sipho", last_name: "Dlamini" };
  const completeSql = (
    c,
    outcome,
    { reasons = [], risk = 10, fingerprint: f = fp(), names = TYPED } = {}
  ) =>
    outcome === "not_finished"
      ? `select api.complete_identity_check('${c.check}','${c.session}','not_finished');`
      : `select api.complete_identity_check('${c.check}','${c.session}','${outcome}',array[${reasons.map(sqlLiteral).join(",")}]::text[],
        ${sqlJsonb(receipt())},${sqlJsonb(receipt())},${sqlJsonb({ fingerprint: f, encrypted_number: encrypted() })},${sqlJsonb(names)},${risk});`;
  const finish = (c, outcome, options) => {
    if (outcome !== "not_finished")
      json(service(`select api.begin_identity_check_evidence('${c.check}','${c.session}');`));
    return json(service(completeSql(c, outcome, options)));
  };
  const claim = (who, caseId) => json(staff(who, `select api.claim_evidence_case('${caseId}');`));
  const returnCase = (caseId) => {
    const held = claim(moderator, caseId);
    return json(
      staff(
        moderator,
        `select api.return_identity_submission('${caseId}',${held.version},'${held.claim_generation}','${held.claim_nonce}','Photo unclear, please retake it.');`
      )
    );
  };
  /** Every evidence file the clean-up job claims now (the job runs until empty). */
  const drainCleanup = () => {
    const ids = [];
    for (let n = 0; n < 50; n += 1) {
      const rows = json(service("select api.claim_evidence_cleanup(100);"));
      if (rows.length === 0) return ids;
      ids.push(...rows.map((r) => r.artifact_id));
    }
    throw new Error("the clean-up job did not finish");
  };
  /** Every partner session the deletion job claims now. */
  const drainProviderDeletions = () => {
    const ids = [];
    for (let n = 0; n < 50; n += 1) {
      const rows = json(service("select api.claim_identity_check_deletions(100);"));
      if (rows.length === 0) return ids;
      ids.push(...rows.map((r) => r.check_id));
    }
    throw new Error("the partner deletion job did not finish");
  };
  const retention = () => json(service("select api.run_retention(5000);")).verification;
  /** The member's identity record as kept: files, ID number, names, phones, fact. */
  const record = (who) =>
    json(`select jsonb_build_object(
      'files',(select coalesce(jsonb_object_agg(a.purpose||':'||a.id,a.state),'{}') from private.evidence_artifacts a where a.owner_id='${who.id}'),
      'numbers',(select count(*) from private.verification_identity_submissions s where s.owner_id='${who.id}' and s.number_erased_at is null),
      'submissions',(select count(*) from private.verification_identity_submissions s where s.owner_id='${who.id}'),
      'names',(select count(*) from private.identity_submission_names n where n.owner_id='${who.id}'),
      'phones',(select count(*) from private.verification_phone_proofs p where p.owner_id='${who.id}'),
      'facts',(select count(*) from private.accepted_identity_facts f where f.owner_id='${who.id}'),
      'checks',(select count(*) from private.identity_checks k where k.owner_id='${who.id}'));`);
  const filesOf = (who, purpose) =>
    q(
      `select coalesce(string_agg(id::text,',' order by created_at),'') from private.evidence_artifacts where owner_id='${who.id}' and purpose='${purpose}';`
    )
      .split(",")
      .filter(Boolean);
  const stateOf = (artifact) =>
    q(`select state from private.evidence_artifacts where id='${artifact}';`);
  /** Marks a member's claimed files deleted, as the storage job would. */
  const deleteClaimed = (who) =>
    q(`set session_replication_role=replica;
      update private.evidence_artifacts set state='deleted',deleted_at=now() where owner_id='${who.id}' and state='cleanup_required';
      set session_replication_role=origin;`);
  /** An accepted member: a clean automatic pass on staff_final. */
  const accepted = (label, options) => {
    setMode("staff_final", "Didit checks, staff have the final say.");
    const m = namedMember(label);
    const c = startWithSession(m);
    assert.equal(finish(c, "approved", options).status, "approved");
    return { ...m, check: c };
  };
  const closeAccount = (who) => q(`select internal.close_account_evidence('${who.id}');`);

  // ------------------------------------------------------------ setting
  await check("the setting accepts all three values once the update is applied", () => {
    assert.deepEqual(setMode("staff_final"), {
      mode: "staff_final",
      changed: true,
      resumed: false,
    });
    assert.deepEqual(setMode("automatic", "Fully automatic from now."), {
      mode: "automatic",
      changed: true,
      resumed: false,
    });
    assert.deepEqual(setMode("manual", "Back to staff review."), {
      mode: "manual",
      changed: true,
      resumed: false,
    });
    assert.equal(
      q(
        `select string_agg(from_mode||'>'||to_mode,',' order by changed_at,id) from private.identity_check_mode_events;`
      ),
      "manual>staff_final,staff_final>automatic,automatic>manual"
    );
    // Still an admin with a recent second factor.
    fails(
      staff(moderator, "select api.set_identity_check_mode('automatic','Moderators may not.');"),
      "42501"
    );
  });
  await check("the start inserts exactly one row (strict)", () => {
    assert.match(
      q(`select pg_get_functiondef('internal.start_my_identity_check()'::regprocedure);`),
      /returning \* into strict k;/
    );
  });

  // ------------------------------------------- moved and names, every mode
  await check("session_moved goes to staff on every setting, automatic included", () => {
    for (const mode of ["staff_final", "automatic", "manual"]) {
      setMode(mode === "manual" ? "staff_final" : mode, `Testing the ${mode} setting.`);
      const c = startWithSession(namedMember(`moved-${mode}`));
      if (mode === "manual") setMode("manual", "Back to staff review.");
      assert.equal(
        finish(c, "approved", { reasons: ["session_moved"] }).status,
        "with_staff",
        mode
      );
      assert.deepEqual(checkRow(c.check).reasons, ["session_moved"], mode);
    }
    // Even with other reasons that would decline on automatic.
    setMode("automatic", "Fully automatic again.");
    const c = startWithSession(namedMember("moved-and-declined"));
    assert.equal(finish(c, "declined", { reasons: ["session_moved"] }).status, "with_staff");
  });
  await check(
    "names at start differing from the submission: staff on manual and staff_final, declined on automatic",
    () => {
      for (const mode of ["manual", "staff_final", "automatic"]) {
        setMode(mode === "manual" ? "staff_final" : mode, `Testing the ${mode} setting.`);
        const m = namedMember(`renamed-${mode}`);
        const c = startWithSession(m);
        const revision = q(`select revision from private.profiles where account_id='${m.id}';`);
        json(member(m, `select api.save_my_legal_name(${revision},'Thandiwe','Dlamini');`));
        if (mode === "manual") setMode("manual", "Back to staff review.");
        // The website compared the new names, so only the start names differ.
        const result = finish(c, "approved", {
          names: { first_name: "Thandiwe", last_name: "Dlamini" },
        });
        assert.equal(result.status, mode === "automatic" ? "declined" : "with_staff", mode);
        assert.deepEqual(checkRow(c.check).reasons, ["names_differ"], mode);
        assert.equal(
          q(`select count(*) from private.accepted_identity_facts where owner_id='${m.id}';`),
          "0"
        );
        if (mode === "automatic") {
          assert.equal(availability(m).check.decline_reason, "names_differ");
          assert.equal(availability(m).check.can_ask_person, true);
        }
      }
    }
  );
  await check("the start context is cleared when a check leaves started", () => {
    setMode("staff_final", "Didit checks, staff have the final say.");
    const m = namedMember("context");
    const c = startWithSession(m);
    const live = checkRow(c.check);
    assert.deepEqual(
      [live.start_first_name, live.start_last_name, live.network_hash, live.device_kind],
      ["Thando Sipho", "Dlamini", NET, "phone"]
    );
    finish(c, "approved");
    const ended = [c.check];
    const n = namedMember("context-unfinished");
    const d = startWithSession(n);
    finish(d, "not_finished");
    ended.push(d.check);
    const u = start(namedMember("context-unavailable")).check_id;
    json(service(`select api.report_identity_check_unavailable('${u}','outage');`));
    ended.push(u);
    q(`update private.identity_check_settings set paused_until=null,pause_reason=null;`);
    const idle = namedMember("context-expired");
    const e = startWithSession(idle);
    shift(idle, "25 hours 1 minute");
    drainProviderDeletions();
    ended.push(e.check);
    for (const id of ended) {
      const row = checkRow(id);
      assert.notEqual(row.status, "started", id);
      assert.deepEqual(
        [row.start_first_name, row.start_last_name, row.network_hash, row.device_kind],
        [null, null, null, null],
        row.status
      );
    }
    // Writing them again on a finished check leaves them cleared.
    q(
      `update private.identity_checks set start_first_name='Thando',start_last_name='Dlamini' where id='${c.check}';`
    );
    assert.equal(checkRow(c.check).start_first_name, null);
  });

  // ------------------------------------------------------ decline reason
  await check("a declined check names a category the page can show", () => {
    setMode("automatic", "Fully automatic again.");
    const bannedPrint = fp();
    q(`set session_replication_role=replica;
      insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
        values('${bannedPrint}',gen_random_uuid(),'fraud',now(),now()+interval '5 years');
      set session_replication_role=origin;`);
    for (const [label, outcome, options, expected] of [
      ["unsure", "in_review", {}, "photo_not_matched"],
      ["declined", "declined", {}, "photo_not_matched"],
      ["unreadable", "approved", { reasons: ["document_not_accepted"] }, "id_unreadable"],
      ["bad-number", "approved", { reasons: ["id_number_invalid"] }, "id_unreadable"],
      ["young", "approved", { reasons: ["under_18"] }, "under_18"],
      ["risky", "approved", { risk: 60 }, "not_confirmed"],
      [
        "banned-renamed",
        "approved",
        { fingerprint: bannedPrint, reasons: ["names_differ"] },
        "not_confirmed",
      ],
    ]) {
      const m = namedMember(`reason-${label}`);
      assert.equal(finish(startWithSession(m), outcome, options).status, "declined", label);
      const seen = availability(m).check;
      assert.equal(seen.decline_reason, expected, label);
      assert.equal(seen.reasons, undefined, label);
    }
    const ok = accepted("reason-none");
    assert.equal(availability(ok).check.decline_reason, null);
  });

  // ----------------------------------------------- accepted identities
  let keptMember;
  await check("accepted: the ID photo goes at day 30, the selfie and ID number stay", () => {
    const m = accepted("kept");
    const [idPhoto] = filesOf(m, "id_front");
    const [selfie] = filesOf(m, "selfie");
    shift(m, "29 days");
    let claimed = drainCleanup();
    assert.ok(!claimed.includes(idPhoto), "day 29: the ID photo stays");
    shift(m, "2 days");
    claimed = drainCleanup();
    assert.ok(claimed.includes(idPhoto), "day 31: the ID photo goes");
    assert.ok(!claimed.includes(selfie), "the selfie stays");
    deleteClaimed(m);
    retention();
    assert.deepEqual(
      { ...record(m), files: undefined },
      { files: undefined, numbers: 1, submissions: 1, names: 1, phones: 1, facts: 1, checks: 1 }
    );
    shift(m, "5 years");
    assert.ok(!drainCleanup().includes(selfie), "an open account keeps its selfie");
    retention();
    assert.equal(record(m).numbers, 1, "and its ID number");
    assert.equal(stateOf(selfie), "clean");
    keptMember = { ...m, selfie };
  });
  // LIM-SQL-IDENTITY-PROVIDER-COPY: 30 days after an acceptance (5 days after a
  // return: the "ask a person" and "sent back" checks below).
  await check("accepted: the partner's copy is due 30 days after the acceptance", () => {
    const m = accepted("partner-copy");
    drainProviderDeletions();
    assert.equal(
      q(`select provider_delete_due=(select reviewed_at+interval '30 days' from private.accepted_identity_facts
        where automatic_check_id=k.id) from private.identity_checks k where k.id='${m.check.check}';`),
      "t"
    );
    shift(m, "29 days");
    assert.ok(!drainProviderDeletions().includes(m.check.check), "day 29");
    shift(m, "1 day 12 hours");
    assert.ok(drainProviderDeletions().includes(m.check.check), "day 30 and a half");
    // A deletion that keeps failing is counted a day after it was due, from the
    // acceptance date: each claim moving its lease 5 minutes ahead hides nothing.
    const before = retention().overdue_partner_deletions;
    shift(m, "1 day");
    assert.ok(drainProviderDeletions().includes(m.check.check), "claimed again after a failure");
    assert.equal(
      q(
        `select provider_delete_due>now() from private.identity_checks where id='${m.check.check}';`
      ),
      "t",
      "the claim moved the lease ahead"
    );
    assert.equal(retention().overdue_partner_deletions, before + 1, "day 31 and a half");
    assert.equal(
      retention().overdue_partner_deletions,
      before + 1,
      "still counted on the next run"
    );
    json(service(`select api.mark_identity_check_provider_deleted('${m.check.check}');`));
    assert.equal(retention().overdue_partner_deletions, before);
  });

  // ----------------------------------------- closed in good standing
  await check(
    "closed in good standing: selfie and ID number within 90 days; code, names and phone 5 years",
    () => {
      const m = keptMember;
      closeAccount(m);
      assert.ok(!drainCleanup().includes(m.selfie), "kept just after closure");
      shift(m, "89 days");
      assert.ok(!drainCleanup().includes(m.selfie), "day 89 after closure");
      retention();
      assert.equal(record(m).numbers, 1, "the ID number too, at day 89");
      shift(m, "2 days");
      assert.ok(drainCleanup().includes(m.selfie), "day 91 after closure");
      deleteClaimed(m);
      retention();
      const after = record(m);
      assert.equal(after.numbers, 0, "the ID number is erased");
      assert.equal(after.submissions, 1, "the blocking code stays");
      assert.equal(after.names, 1, "the legal names stay");
      assert.equal(after.phones, 1, "the verified phone stays");
      // The 90-day cap holds for a file that is otherwise not yet due.
      const pending = namedMember("closed-pending");
      setMode("staff_final", "Didit checks, staff have the final say.");
      const c = startWithSession(pending);
      finish(c, "approved", { reasons: ["names_differ"] });
      closeAccount(pending);
      const files = [...filesOf(pending, "id_front"), ...filesOf(pending, "selfie")];
      shift(pending, "89 days");
      assert.deepEqual(
        drainCleanup().filter((id) => files.includes(id)),
        [],
        "day 89 after closure"
      );
      shift(pending, "2 days");
      assert.deepEqual(
        drainCleanup()
          .filter((id) => files.includes(id))
          .sort(),
        [...files].sort(),
        "day 91 after closure"
      );
      // Numbers verified when the account closed are not deleted 30 days later.
      shift(m, "31 days");
      retention();
      assert.equal(record(m).phones, 1, "31 days after closure");
      // A number replaced before the account closed still goes after 30 days.
      const replaced = namedMember("replaced-phone");
      q(
        `update private.verification_phone_proofs set revoked_at=now()-interval '40 days' where owner_id='${replaced.id}';`
      );
      closeAccount(replaced);
      retention();
      assert.equal(record(replaced).phones, 0);
      // Without an accepted identity, the number goes 30 days after closure.
      const unverified = namedMember("closed-unverified");
      closeAccount(unverified);
      shift(unverified, "29 days");
      retention();
      assert.equal(record(unverified).phones, 1, "29 days after closure");
      shift(unverified, "2 days");
      retention();
      assert.equal(record(unverified).phones, 0, "31 days after closure");
    }
  );
  await check("the five-year sweep waits for the partner's copy, then removes the record", () => {
    const m = keptMember;
    // The partner's copy of its check (accepted 5 years ago) is not yet deleted.
    q(`update private.identity_checks set provider_delete_due=null where owner_id='${m.id}';`);
    // Closed 122 days ago so far: 4 years 364 days after closure.
    shift(m, "4 years 242 days");
    retention();
    assert.equal(record(m).submissions, 1, "under 5 years after closure");
    shift(m, "2 days");
    retention();
    assert.equal(record(m).submissions, 1, "kept while the partner holds a copy");
    const due = drainProviderDeletions();
    assert.ok(due.includes(m.check.check));
    json(service(`select api.mark_identity_check_provider_deleted('${m.check.check}');`));
    const swept = retention();
    assert.ok(swept.closed_account_verification_histories >= 1, JSON.stringify(swept));
    assert.deepEqual(record(m), {
      files: {},
      numbers: 0,
      submissions: 0,
      names: 0,
      phones: 0,
      facts: 0,
      checks: 0,
    });
  });

  // -------------------------------------------------------------- bans
  await check(
    "a ban approved within 90 days of closure keeps the selfie and ID number 5 years from the ban",
    () => {
      const print = fp();
      const m = accepted("banned-member", { fingerprint: print });
      const [selfie] = filesOf(m, "selfie");
      closeAccount(m);
      shift(m, "60 days");
      q(`set session_replication_role=replica;
      insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
        values('${print}',gen_random_uuid(),'fraud',now(),now()+interval '5 years');
      set session_replication_role=origin;`);
      shift(m, "31 days");
      assert.ok(!drainCleanup().includes(selfie), "day 91 after closure, banned");
      shift(m, "4 years 333 days");
      assert.ok(!drainCleanup().includes(selfie), "under 5 years from the ban");
      retention();
      assert.equal(record(m).numbers, 1);
      shift(m, "2 days");
      assert.ok(drainCleanup().includes(selfie), "the ban has expired");
      retention();
      assert.equal(record(m).numbers, 0);
    }
  );

  await check("an open report on a closed account keeps the selfie and ID number", () => {
    const m = accepted("reported-member");
    const [selfie] = filesOf(m, "selfie");
    closeAccount(m);
    const report = q(`set session_replication_role=replica;
      insert into private.reports(subject_account_id,category,description,reporter_ip_hmac)
        values('${m.id}','scam','A synthetic open report on this account.',
          '${"r".repeat(43)}') returning id;
      set session_replication_role=origin;`)
      .split("\n")
      .find((line) => /^[0-9a-f-]{36}$/.test(line));
    shift(m, "91 days");
    assert.ok(!drainCleanup().includes(selfie), "the report is open");
    retention();
    assert.equal(record(m).numbers, 1);
    q(`set session_replication_role=replica; delete from private.reports where id='${report}';
      set session_replication_role=origin;`);
    assert.ok(drainCleanup().includes(selfie), "the report is resolved");
    retention();
    assert.equal(record(m).numbers, 0);
  });

  // --------------------------------------------------- failed attempts
  await check("a submission replaced by a newer one keeps its files 5 days", () => {
    setMode("staff_final", "Didit checks, staff have the final say.");
    const m = namedMember("replaced-submission");
    const first = startWithSession(m);
    finish(first, "approved", { reasons: ["names_differ"] });
    const oldFiles = [...filesOf(m, "id_front"), ...filesOf(m, "selfie")];
    assert.equal(
      q(`select count(*) from private.evidence_artifacts where id in (${oldFiles.map(sqlLiteral).join(",")})
        and retain_until is null;`),
      "2",
      "waiting for staff"
    );
    // A new automatic result while the first waits for staff replaces it.
    const second = startWithSession(m);
    finish(second, "approved", { reasons: ["names_differ"] });
    shift(m, "4 days 23 hours");
    assert.deepEqual(
      drainCleanup().filter((id) => oldFiles.includes(id)),
      [],
      "inside the 5 days"
    );
    shift(m, "2 hours");
    assert.deepEqual(
      drainCleanup()
        .filter((id) => oldFiles.includes(id))
        .sort(),
      [...oldFiles].sort(),
      "after the 5 days"
    );
    assert.equal(checkRow(second.check).status, "with_staff", "the newer one still waits");
  });

  // LIM-SQL-IDENTITY-ATTEMPT-FILES (5 days) and LIM-SQL-IDENTITY-CHECK-ROW (7 days).
  await check(
    "an automatic decline keeps its files 5 days; then only the fingerprint is left",
    () => {
      setMode("automatic", "Fully automatic again.");
      const m = namedMember("declined-files");
      const c = startWithSession(m);
      finish(c, "declined");
      const files = [...filesOf(m, "id_front"), ...filesOf(m, "selfie")];
      assert.equal(files.length, 2);
      shift(m, "4 days 23 hours");
      assert.deepEqual(
        drainCleanup().filter((id) => files.includes(id)),
        [],
        "inside the 5 days"
      );
      shift(m, "2 hours");
      assert.deepEqual(
        drainCleanup()
          .filter((id) => files.includes(id))
          .sort(),
        [...files].sort(),
        "after the 5 days"
      );
      deleteClaimed(m);
      retention();
      const left = record(m);
      assert.equal(left.numbers, 0, "the ID number is erased");
      assert.equal(left.names, 0, "the names go");
      assert.equal(left.submissions, 1, "the fingerprint stays");
      assert.equal(
        q(`select count(*) from private.identity_submission_names n join private.verification_identity_submissions s
          on s.id=n.submission_id where s.owner_id='${m.id}';`),
        "0"
      );
      // The check row goes 7 days after it finished, once the partner's copy is deleted.
      assert.ok(drainProviderDeletions().includes(c.check));
      retention();
      assert.equal(record(m).checks, 1, "the partner's copy is not yet deleted");
      json(service(`select api.mark_identity_check_provider_deleted('${c.check}');`));
      retention();
      assert.equal(record(m).checks, 1, "6 days after it finished");
      shift(m, "2 days");
      retention();
      assert.equal(record(m).checks, 0, "8 days after it finished");
      assert.equal(record(m).submissions, 1, "the fingerprint stays");
    }
  );
  await check(
    "a failing partner deletion of a declined check counts 32 days after it finished; one waiting for a person does not",
    () => {
      setMode("automatic", "Fully automatic again.");
      const declined = namedMember("overdue-declined");
      const d = startWithSession(declined);
      finish(d, "declined");
      const asked = namedMember("overdue-asked");
      const a = startWithSession(asked);
      finish(a, "declined");
      json(
        member(
          asked,
          `select api.ask_person_identity_check('${a.check}','My ID is genuine, please check it by hand.');`
        )
      );
      shift(declined, "6 days");
      assert.ok(drainProviderDeletions().includes(d.check), "due 5 days after the decline");
      const before = retention().overdue_partner_deletions;
      // The deletion keeps failing: every retry moves its lease 5 minutes ahead.
      shift(declined, "25 days 12 hours");
      assert.ok(drainProviderDeletions().includes(d.check));
      assert.equal(
        retention().overdue_partner_deletions,
        before,
        "31 and a half days after it finished"
      );
      shift(declined, "1 day");
      assert.ok(drainProviderDeletions().includes(d.check));
      assert.equal(
        retention().overdue_partner_deletions,
        before + 1,
        "32 and a half days after it finished"
      );
      shift(asked, "40 days");
      drainProviderDeletions();
      assert.equal(checkRow(a.check).provider_delete_due, null, "a person is still to decide");
      assert.equal(
        retention().overdue_partner_deletions,
        before + 1,
        "the waiting check is not counted"
      );
      json(service(`select api.mark_identity_check_provider_deleted('${d.check}');`));
      assert.equal(retention().overdue_partner_deletions, before);
    }
  );
  await check(
    "ask a person keeps the files until a person decides; a return then starts 5 days",
    () => {
      setMode("automatic", "Fully automatic again.");
      const m = namedMember("asked-files");
      const c = startWithSession(m);
      finish(c, "declined");
      const files = [...filesOf(m, "id_front"), ...filesOf(m, "selfie")];
      json(
        member(
          m,
          `select api.ask_person_identity_check('${c.check}','My ID is genuine, please check it by hand.');`
        )
      );
      shift(m, "6 days");
      assert.deepEqual(
        drainCleanup().filter((id) => files.includes(id)),
        [],
        "a person is still to decide"
      );
      drainProviderDeletions();
      assert.equal(
        checkRow(c.check).provider_delete_due,
        null,
        "no partner deletion while waiting"
      );
      retention();
      assert.equal(record(m).checks, 1, "the check stays while a person decides");
      assert.equal(returnCase(checkRow(c.check).case_id).status, "needs_resubmission");
      drainProviderDeletions();
      assert.equal(
        q(`select provider_delete_due between now()+interval '5 days'-interval '1 minute' and now()+interval '5 days'
        from private.identity_checks where id='${c.check}';`),
        "t",
        "the partner's copy is due 5 days after the return"
      );
      shift(m, "4 days 23 hours");
      assert.deepEqual(
        drainCleanup().filter((id) => files.includes(id)),
        [],
        "inside 5 days of the return"
      );
      shift(m, "2 hours");
      assert.equal(drainCleanup().filter((id) => files.includes(id)).length, 2);
    }
  );
  await check("ask a person answered by an acceptance: the partner's copy 30 days later", () => {
    setMode("automatic", "Fully automatic again.");
    const m = namedMember("asked-accepted");
    const c = startWithSession(m);
    finish(c, "declined");
    json(
      member(
        m,
        `select api.ask_person_identity_check('${c.check}','My ID is genuine, please check it by hand.');`
      )
    );
    const row = checkRow(c.check);
    const held = claim(moderator, row.case_id);
    assert.equal(
      json(
        staff(
          moderator,
          `select api.review_identity_submission('${row.submission_id}',${held.version},'${held.claim_generation}','${held.claim_nonce}',true,true);`
        )
      ).status,
      "accepted"
    );
    drainProviderDeletions();
    assert.equal(
      q(`select k.provider_delete_due=f.reviewed_at+interval '30 days' from private.identity_checks k
        join private.accepted_identity_facts f on f.submission_id=k.submission_id where k.id='${c.check}';`),
      "t"
    );
    // Kept with the identity record, with its reason.
    shift(m, "40 days");
    drainProviderDeletions();
    json(service(`select api.mark_identity_check_provider_deleted('${c.check}');`));
    retention();
    assert.equal(record(m).checks, 1);
    assert.notEqual(checkRow(c.check).ask_reason, null);
    // A closed account's reasons go 90 days after closure.
    closeAccount(m);
    shift(m, "89 days");
    retention();
    assert.notEqual(checkRow(c.check).ask_reason, null, "day 89 after closure");
    shift(m, "2 days");
    assert.ok(retention().closed_account_ask_reasons >= 1);
    const cleared = checkRow(c.check);
    assert.equal(cleared.ask_reason, null, "day 91 after closure");
    assert.notEqual(cleared.asked_at, null, "the request stays recorded");
  });
  await check(
    "sent back by staff: files 5 days, the partner's copy 5 days, and a newer submission stays reviewable",
    () => {
      setMode("staff_final", "Didit checks, staff have the final say.");
      const m = namedMember("returned");
      const first = startWithSession(m);
      finish(first, "approved", { reasons: ["names_differ"] });
      const oldFiles = [...filesOf(m, "id_front"), ...filesOf(m, "selfie")];
      const caseId = checkRow(first.check).case_id;
      drainProviderDeletions();
      assert.equal(checkRow(first.check).provider_delete_due, null, "waiting for staff");
      returnCase(caseId);
      drainProviderDeletions();
      assert.notEqual(checkRow(first.check).provider_delete_due, null, "sent back");
      // The member tries again; the new result waits for staff.
      const second = startWithSession(m);
      finish(second, "approved", { reasons: ["names_differ"] });
      const pending = checkRow(second.check);
      const version = q(`select version from private.evidence_cases where id='${caseId}';`);
      // Only the sent-back files' dates move: 6 days later.
      q(`set session_replication_role=replica;
        update private.evidence_artifacts set retain_until=retain_until-interval '6 days'
          where id in (${oldFiles.map(sqlLiteral).join(",")});
        set session_replication_role=origin;`);
      assert.deepEqual(
        drainCleanup()
          .filter((id) => oldFiles.includes(id))
          .sort(),
        [...oldFiles].sort()
      );
      assert.equal(
        q(`select version from private.evidence_cases where id='${caseId}';`),
        version,
        "deleting the sent-back files does not change the case"
      );
      const held = claim(moderator, caseId);
      assert.equal(
        json(
          staff(
            moderator,
            `select api.review_identity_submission('${pending.submission_id}',${held.version},'${held.claim_generation}','${held.claim_nonce}',true,true);`
          )
        ).status,
        "accepted"
      );
    }
  );

  // ------------------------------------------- authority-request logs
  // LIM-SQL-IDENTITY-DISCLOSURE-LOG: 5 years.
  await check(
    "authority-request logs: while a named account exists plus 5 years; no match, 5 years",
    () => {
      const open = namedMember("disclosed-open");
      const closedOld = namedMember("disclosed-closed-old");
      const closedRecent = namedMember("disclosed-closed-recent");
      for (const who of [closedOld, closedRecent]) closeAccount(who);
      shift(closedOld, "5 years 1 day");
      shift(closedRecent, "4 years 364 days");
      const insert = (label, ago, outcome, subjects) =>
        q(`insert into private.identity_disclosures(opened_by,opened_at,closes_at,request_type,request_reference,reason,
            attested,lookup_kind,lookup_value,outcome,subject_ids,match_count)
          values('${admin.id}',now()-interval '${ago}',now()-interval '${ago}'+interval '15 minutes','subpoena',
            ${sqlLiteral(`REF-${label}`)},'Synthetic authority request.',true,'phone','+27830000000','${outcome}',
            array[${subjects.map((s) => `'${s.id}'`).join(",")}]::uuid[],${subjects.length})
          returning id;`);
      const rows = {
        noMatchOld: insert("no-match-old", "5 years 1 day", "no_match", []),
        noMatchRecent: insert("no-match-recent", "4 years 364 days", "no_match", []),
        openOld: insert("open-old", "6 years", "record", [open]),
        closedOld: insert("closed-old", "6 years", "record", [closedOld]),
        closedRecent: insert("closed-recent", "6 years", "record", [closedRecent]),
        mixed: insert("mixed", "6 years", "record", [closedOld, open]),
      };
      q(`insert into private.identity_disclosure_events(disclosure_id,staff_id,kind)
        values('${rows.closedOld}','${admin.id}','viewed');`);
      assert.ok(retention().identity_disclosures >= 2);
      const left = q(
        `select string_agg(request_reference,',' order by request_reference) from private.identity_disclosures
          where request_reference like 'REF-%';`
      );
      assert.equal(left, "REF-closed-recent,REF-mixed,REF-no-match-recent,REF-open-old");
      assert.equal(
        q(
          `select count(*) from private.identity_disclosure_events where disclosure_id='${rows.closedOld}';`
        ),
        "0"
      );
      // Anything else still refuses deletes.
      fails(`delete from private.identity_disclosures where id='${rows.openOld}';`, "23514");
    }
  );
  await check(
    "authority-request logs: a request about an erased account goes 5 years after the request",
    () => {
      const run = () => json(service("select api.run_retention(5000);"));
      const gone = syntheticMember("disclosed-erased");
      const existing = syntheticMember("disclosed-existing");
      const signedInAt = Math.floor(Date.now() / 1000) - 60;
      json(
        as(
          { ...claims(gone), amr: [{ method: "password", timestamp: signedInAt }] },
          "select api.close_my_account();"
        )
      );
      // Closed 31 days ago: the erasure runs and the Auth user is removed.
      q(`set session_replication_role=replica;
        update private.account_erasures set closed_at=closed_at-interval '31 days',erase_after=erase_after-interval '31 days'
          where user_id='${gone.id}';
        update private.account_closures set closed_at=closed_at-interval '31 days',
          evidence_delete_after=evidence_delete_after-interval '31 days' where user_id='${gone.id}';
        set session_replication_role=origin;`);
      const authLeft = () => q(`select count(*) from auth.users where id='${gone.id}';`);
      run();
      for (let n = 0; n < 3 && authLeft() !== "0"; n += 1) {
        q(`update private.account_erasures set auth_checked_at=auth_checked_at-interval '2 days'
          where user_id='${gone.id}';`);
        run();
      }
      assert.equal(authLeft(), "0", "the Auth user is removed");
      assert.equal(
        q(`select count(*) from private.account_closures where user_id='${gone.id}';`),
        "0"
      );
      // The request came 70 days after the closure, 5 years and 40 days ago; by
      // now the erasure record (kept 5 years after the erasure) is gone too.
      q(`set session_replication_role=replica;
        update private.account_erasures set closed_at=closed_at-interval '5 years 79 days',
          erase_after=erase_after-interval '5 years 79 days',erased_at=erased_at-interval '5 years 79 days',
          auth_removed_at=auth_removed_at-interval '5 years 79 days',
          auth_checked_at=auth_checked_at-interval '5 years 79 days'
          where user_id='${gone.id}';
        set session_replication_role=origin;`);
      run();
      assert.equal(
        q(`select count(*) from private.account_erasures where user_id='${gone.id}';`),
        "0"
      );
      const insert = (label, ago, who) =>
        q(`insert into private.identity_disclosures(opened_by,opened_at,closes_at,request_type,request_reference,reason,
            attested,lookup_kind,lookup_value,outcome,subject_ids,match_count)
          values('${admin.id}',now()-interval '${ago}',now()-interval '${ago}'+interval '15 minutes','subpoena',
            ${sqlLiteral(`ERASED-${label}`)},'Synthetic authority request.',true,'phone','+27830000000','record',
            array['${who.id}']::uuid[],1);`);
      insert("old", "5 years 40 days", gone);
      insert("recent", "4 years 364 days", gone);
      insert("existing", "5 years 40 days", existing);
      run();
      assert.equal(
        q(`select string_agg(request_reference,',' order by request_reference) from private.identity_disclosures
          where request_reference like 'ERASED-%';`),
        "ERASED-existing,ERASED-recent"
      );
    }
  );
  // LIM-SQL-IDENTITY-MODE-LOG: 5 years.
  await check("the setting's change log is kept 5 years", () => {
    q(`insert into private.identity_check_mode_events(from_mode,to_mode,changed_by,reason,changed_at) values
      ('manual','automatic','${admin.id}','An old change of the setting.',now()-interval '5 years 1 day'),
      ('automatic','manual','${admin.id}','A recent change of the setting.',now()-interval '4 years 364 days');`);
    assert.equal(retention().identity_check_mode_events, 1);
    assert.equal(
      q(
        `select count(*) from private.identity_check_mode_events where reason like 'An old change%';`
      ),
      "0"
    );
    assert.equal(
      q(
        `select count(*) from private.identity_check_mode_events where reason like 'A recent change%';`
      ),
      "1"
    );
  });

  await check(
    "staff operations health: a kept selfie is not overdue; an overdue file still counts",
    () => {
      const overdue = () =>
        json(staff(admin, "select api.get_staff_operations_health();")).deletions.evidence_overdue;
      const members = ["health-1", "health-2", "health-3"].map((label) => accepted(label));
      for (const m of members) shift(m, "40 days");
      // The clean-up job takes every file due (the three ID photos among them).
      drainCleanup();
      for (const m of members) assert.equal(stateOf(filesOf(m, "selfie")[0]), "clean");
      assert.equal(overdue(), 0, "three accepted members at day 40: their selfies are kept");
      setMode("automatic", "Fully automatic again.");
      const declined = namedMember("health-declined");
      finish(startWithSession(declined), "declined");
      shift(declined, "7 days");
      assert.equal(overdue(), 2, "a declined attempt's two files, due 5 days after the decline");
      assert.equal(drainCleanup().length, 2);
      assert.equal(overdue(), 0);
    }
  );

  await check("holds keep a failed attempt's check, names and files", () => {
    setMode("automatic", "Fully automatic again.");
    const m = namedMember("held");
    const c = startWithSession(m);
    finish(c, "declined");
    q(`insert into private.legal_holds(subject_id,reason,placed_by)
      values('${m.id}','Synthetic legal hold for the check.','${admin.id}');`);
    shift(m, "30 days");
    const files = [...filesOf(m, "id_front"), ...filesOf(m, "selfie")];
    assert.deepEqual(
      drainCleanup().filter((id) => files.includes(id)),
      []
    );
    q(
      `update private.identity_checks set provider_deleted_at=now(),provider_delete_due=null where id='${c.check}';`
    );
    retention();
    assert.deepEqual(
      { ...record(m), files: undefined },
      { files: undefined, numbers: 1, submissions: 1, names: 1, phones: 1, facts: 0, checks: 1 }
    );
    setMode("manual", "Back to staff review.");
  });

  // ------------------------------------------------- later updates
  applySteps(database, steps.slice(index + 1));
  await check("later updates apply after this one", () => {
    assert.equal(
      q(`select to_regprocedure('internal.identity_record_kept(uuid)') is not null;`),
      "t"
    );
  });
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Identity keep-for passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);

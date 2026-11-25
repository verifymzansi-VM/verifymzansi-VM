#!/usr/bin/env node
// Behaviour checks for 20261125213005_release_one_phone_number.sql (launch
// checklist item 21): staff free one phone number a ban blocks while the ID
// ban stays, with a proposal and a different staff member's approval.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks (members and
// staff written directly as the database owner, accepted ID reviews as
// synthetic identity facts, staff acting through the production API commands
// with synthetic sessions). Bans are recorded through
// internal.record_identity_ban, as an approved account restriction does; the
// restriction case and decision and earlier (revoked) phone proofs are written
// directly. Codes are asked for through the production service commands; no
// SMS is sent. The script checks the read-only preflight, a drifted body and a
// premature rollback, applies the update and proves apply -> rollback ->
// apply, then checks the rules. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-release-one-phone-number.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { phoneChecks } from "./lib/foundation-phone-checks.mjs";
import { assertReadOnlyPreflight, executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125213005_release_one_phone_number.sql";
const BANNED = "internal.phone_number_banned(text)";
const REVIEWED = "ddfab60ae9bad5a5b3f8fb3c5200ade3";
const UPDATED = "07c5a85df974869e998f05d22ba00240";
const LABEL = "release one phone number";
const NOT_APPLIED =
  /^release one phone number: update not applied; numbers blocked: \d+; release requests waiting: 0; numbers released: 0$/;
const APPLIED =
  /^release one phone number: already applied; numbers blocked: \d+; release requests waiting: \d+; numbers released: \d+$/;
const COMMANDS = [
  "api.propose_phone_number_release(text,text)",
  "api.review_phone_number_release(text,boolean)",
  "api.get_phone_number_releases()",
];
// The banned person's older numbers, and a number a staff member once had.
const OLDER = "+27730000001";
const OTHER = "+27730000002";
const SPARE = "+27730000003";
const STAFFS = "+27730000004";
const REASON = "The network re-issued this number to someone else";

const SETUP = { update: UPDATE, label: "release", title: "Release one phone number" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin, admin2 } = run;
  const { q, json, fails, member, staff, preflight } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const asOwner = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
  const { createSql, create, refusedWith } = phoneChecks(kit);
  /** Running `sql` fails with `state` and this detail; returns stderr. */
  const refused = (sql, state, detail) => {
    const stderr = fails(sql, state);
    assert.equal(/^DETAIL:\s+(\S+)/m.exec(stderr)?.[1], detail, stderr);
    return stderr;
  };
  /** An earlier, revoked proof of `phone` for `owner`, written directly. */
  const formerly = (owner, phone) =>
    asOwner(`insert into private.verification_phone_proofs(owner_id,challenge_id,phone,verified_at,contact_changed_at,revoked_at)
      values('${owner.id}',gen_random_uuid(),'${phone}',now()-interval '60 days',now()-interval '60 days',now()-interval '20 days');`);
  const reviewer = world.staffUser("release-reviewer", "admin");
  const approver = world.staffUser("release-approver", "admin");
  /** An approved account restriction of `owner`; returns its decision id. */
  const restriction = (owner) => {
    const [caseId, decision] = [randomUUID(), randomUUID()];
    asOwner(`insert into private.evidence_cases(id,subject_id,kind,status) values('${caseId}','${owner.id}','restriction','decided');
      insert into private.decisions(id,case_id,action,payload,case_version,reviewed_snapshot,proposed_by,proposed_at,
          approved_by,approved_at,status,scope_kind)
        values('${decision}','${caseId}','restrict_account','{}'::jsonb,1,'[]'::jsonb,'${reviewer.id}',now(),
          '${approver.id}',now(),'approved','native');`);
    return decision;
  };
  const ban = (decision, person) =>
    q(`select internal.record_identity_ban('${decision}','${person.fingerprint}','fraud');`);
  const isBanned = (phone) => q(`select internal.phone_number_banned('${phone}');`) === "t";
  const proposeSql = (who, phone, reason = REASON) =>
    staff(who, `select api.propose_phone_number_release('${phone}','${reason}');`);
  const reviewSql = (who, phone, approve = true) =>
    staff(who, `select api.review_phone_number_release('${phone}',${approve});`);
  const releases = (who) => json(staff(who, "select api.get_phone_number_releases();"));
  const rows = (phone) =>
    json(`select coalesce(jsonb_agg(to_jsonb(n) order by identity_hmac),'[]') from private.banned_phone_numbers n
      where phone='${phone}';`);

  // The banned person: an accepted identity and an active number (made by the
  // world), two older numbers and a spare one, banned through an approved
  // restriction.
  const person = world.verified("release-person", reviewer);
  const CURRENT = q(
    `select phone from private.verification_phone_proofs where owner_id='${person.id}' and revoked_at is null;`
  );
  for (const phone of [OLDER, OTHER, SPARE, STAFFS]) formerly(person, phone);
  const banDecision = restriction(person);
  ban(banDecision, person);
  const newcomer = world.user("release-newcomer");

  // ------------------------------------------------------------ before
  await check("before the update: the numbers are blocked and nothing can release one", () => {
    assert.equal(bodyMd5(BANNED), REVIEWED);
    for (const signature of COMMANDS) assert.equal(bodyMd5(signature), "missing");
    for (const phone of [CURRENT, OLDER, OTHER]) assert.ok(isBanned(phone), phone);
  });
  await check("preflight: read only, summary only, before the update", () => {
    const result = preflight();
    assert.deepEqual(
      result.map((r) => r[0]),
      ["summary"],
      JSON.stringify(result)
    );
    assert.match(result[0][1], NOT_APPLIED);
    assert.match(result[0][1], /numbers blocked: 5;/);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and a drifted body are refused", () => {
    assertDriftRefused(kit, { label: LABEL, signatures: [BANNED], rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: LABEL,
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  const governor = world.staffUser("release-governor", "governor");
  const moderator = world.staffUser("release-moderator", "moderator");

  await check("only admins and governors may ask, with a valid number and reason", () => {
    assert.equal(bodyMd5(BANNED), UPDATED);
    fails(
      member(newcomer, `select api.propose_phone_number_release('${OLDER}','${REASON}');`),
      "42501"
    );
    fails(proposeSql(moderator, OLDER), "42501", /capability not granted/);
    fails(proposeSql(admin, "+2773"), "22023", /valid phone number required/);
    fails(proposeSql(admin, OLDER, "too short"), "22023");
    refused(proposeSql(admin, "+27739999999"), "PT404", "phone_not_blocked");
    assert.ok(isBanned(OLDER));
  });

  await check("a release waits for a different staff member's approval", () => {
    assert.deepEqual(json(proposeSql(admin, OLDER)), { phone: OLDER, status: "proposed" });
    // The same request again is the waiting one; another one is refused.
    assert.equal(json(proposeSql(admin, OLDER)).reused, true);
    refused(
      proposeSql(admin2, OLDER, "Another reason for the same number"),
      "PT409",
      "phone_release_pending"
    );
    refused(reviewSql(admin, OLDER), "42501", "phone_release_same_staff");
    assert.ok(isBanned(OLDER), "still blocked while waiting");
    refusedWith(createSql(newcomer, OLDER), "phone_banned");

    assert.deepEqual(json(reviewSql(admin2, OLDER)), { phone: OLDER, status: "released" });
    assert.ok(!isBanned(OLDER));
    const [row] = rows(OLDER);
    assert.equal(row.release_proposed_by, admin.id);
    assert.equal(row.released_by, admin2.id);
    assert.equal(row.release_reason, REASON);
    assert.ok(row.released_at && row.release_proposed_at);
    // The same approval again is answered as applied.
    assert.equal(json(reviewSql(admin2, OLDER)).reused, true);
    // Whoever holds the number now gets a code.
    assert.ok(create(newcomer, OLDER).challenge_id);
  });

  await check("the ID ban and the person's other numbers stay blocked", () => {
    assert.equal(json(`select internal.identity_status('${person.fingerprint}');`).banned, true);
    for (const phone of [CURRENT, OTHER, SPARE]) assert.ok(isBanned(phone), phone);
    refusedWith(createSql(world.user("release-other"), OTHER), "phone_banned");
  });

  await check("a replacement decision or a later ban keeps the release", () => {
    q(
      `update private.banned_identities set decision_id='${restriction(person)}' where identity_hmac='${person.fingerprint}';`
    );
    ban(restriction(person), person);
    assert.equal(rows(OLDER).length, 1);
    assert.ok(rows(OLDER)[0].released_at);
    assert.ok(!isBanned(OLDER));
    assert.ok(isBanned(OTHER));
  });

  await check("releasing the banned account's active number revokes only that proof", () => {
    const otherProofs = q(
      `select count(*) from private.verification_phone_proofs where owner_id='${person.id}' and revoked_at is not null;`
    );
    assert.equal(json(proposeSql(governor, CURRENT)).status, "proposed");
    assert.equal(json(reviewSql(admin, CURRENT)).status, "released");
    assert.equal(
      q(
        `select count(*) from private.verification_phone_proofs where phone='${CURRENT}' and revoked_at is null;`
      ),
      "0"
    );
    assert.equal(
      q(
        `select count(*) from private.verification_phone_proofs where owner_id='${person.id}' and revoked_at is not null;`
      ),
      String(Number(otherProofs) + 1)
    );
    // Not 'in use' any more: the new holder gets a code.
    assert.ok(create(world.user("release-new-holder"), CURRENT).challenge_id);
  });

  await check("staff who verified a number cannot ask for or approve its release", () => {
    const staffMember = world.staffUser("release-staff-holder", "admin");
    formerly(staffMember, STAFFS);
    refused(proposeSql(staffMember, STAFFS), "42501", "phone_release_conflict");
    assert.equal(json(proposeSql(admin, STAFFS)).status, "proposed");
    refused(reviewSql(staffMember, STAFFS), "42501", "phone_release_conflict");
    const listed = releases(staffMember).pending.find((p) => p.phone === STAFFS);
    assert.equal(listed.conflicted, true);
    assert.equal(json(reviewSql(admin2, STAFFS, false)).status, "rejected");
  });

  await check("the proposer or another staff member may reject; a rejected request is gone", () => {
    assert.equal(json(proposeSql(admin, OTHER)).status, "proposed");
    assert.equal(json(reviewSql(admin, OTHER, false)).status, "rejected");
    refused(reviewSql(admin2, OTHER), "PT409", "phone_release_not_pending");
    const [row] = rows(OTHER);
    assert.equal(row.release_reason, null);
    assert.equal(row.release_proposed_by, null);
    assert.ok(isBanned(OTHER));
  });

  await check("a request expires after 7 days, and can then be asked again", () => {
    assert.equal(json(proposeSql(admin, OTHER)).status, "proposed");
    asOwner(
      `update private.banned_phone_numbers set release_proposed_at=now()-interval '8 days' where phone='${OTHER}';`
    );
    refused(reviewSql(admin2, OTHER), "PT409", "phone_release_not_pending");
    assert.ok(isBanned(OTHER));
    assert.equal(json(proposeSql(admin2, OTHER)).status, "proposed");
    assert.equal(json(reviewSql(admin, OTHER, false)).status, "rejected");
  });

  await check("a proposer who no longer holds the capability cannot be approved", () => {
    const leaving = world.staffUser("release-leaving", "governor");
    assert.equal(json(proposeSql(leaving, SPARE)).status, "proposed");
    asOwner(`update private.staff_roles set revoked_at=now() where user_id='${leaving.id}';`);
    refused(reviewSql(admin, SPARE), "PT409", "phone_release_changed");
    assert.ok(isBanned(SPARE));
    assert.equal(json(reviewSql(admin, SPARE, false)).status, "rejected");
  });

  await check("staff see waiting requests and recent releases with the full number", () => {
    assert.equal(json(proposeSql(admin, SPARE)).status, "proposed");
    const mine = releases(admin);
    assert.equal(mine.actor_id, admin.id);
    const waiting = mine.pending.find((p) => p.phone === SPARE);
    assert.equal(waiting.proposed_by_me, true);
    assert.equal(waiting.conflicted, false);
    assert.equal(waiting.reason, REASON);
    assert.ok(Date.parse(waiting.expires_at) > Date.parse(waiting.proposed_at));
    assert.equal(releases(admin2).pending.find((p) => p.phone === SPARE).proposed_by_me, false);
    const released = mine.released.map((r) => r.phone);
    assert.ok(released.includes(OLDER) && released.includes(CURRENT), JSON.stringify(released));
    assert.ok(!released.includes(OTHER));
    // Blocked numbers nobody asked about are never listed.
    assert.ok(![...mine.pending, ...mine.released].some((r) => r.phone === OTHER));
    fails(member(newcomer, "select api.get_phone_number_releases();"), "42501");
    fails(
      staff(moderator, "select api.get_phone_number_releases();"),
      "42501",
      /capability not granted/
    );
  });

  await check("lifting the whole ban still frees every number and its marks", () => {
    q(`delete from private.banned_identities where identity_hmac='${person.fingerprint}';`);
    assert.deepEqual(rows(OLDER), []);
    assert.deepEqual(rows(SPARE), []);
    assert.ok(!isBanned(OTHER));
    refused(reviewSql(admin2, SPARE), "PT404", "phone_not_blocked");
  });

  await check("grants: staff commands for signed-in staff only; no table access", () => {
    const signedIn = { anon: false, authenticated: true, service_role: false };
    assert.deepEqual(
      executeGrants(json, COMMANDS),
      Object.fromEntries(COMMANDS.map((c) => [c, signedIn]))
    );
    const none = { anon: false, authenticated: false, service_role: false };
    assert.deepEqual(executeGrants(json, [BANNED, "internal.phone_release_conflict(uuid,text)"]), {
      [BANNED]: none,
      "internal.phone_release_conflict(uuid,text)": none,
    });
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        q(
          `select has_table_privilege('${role}','private.banned_phone_numbers','select,insert,update,delete');`
        ),
        "f",
        role
      );
  });

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the release rule", () => {
      assert.equal(bodyMd5(BANNED), UPDATED);
      const again = world.verified("release-later", reviewer);
      formerly(again, "+27730000009");
      ban(restriction(again), again);
      assert.ok(isBanned("+27730000009"));
      assert.equal(json(proposeSql(admin, "+27730000009")).status, "proposed");
      assert.equal(json(reviewSql(admin2, "+27730000009")).status, "released");
      assert.ok(!isBanned("+27730000009"));
    });
  }
});

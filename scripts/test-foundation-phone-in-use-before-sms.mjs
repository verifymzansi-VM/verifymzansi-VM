#!/usr/bin/env node
// Behaviour checks for 20261116194000_phone_in_use_before_sms.sql: creating a
// phone challenge is refused with PT409 and a listed reason, before a challenge
// is stored, for the member's own verified number (phone_already_verified), a
// change of number within 15 days (phone_change_cooldown, with the time it is
// allowed from as the hint) or without a current verified identity
// (phone_change_identity_required), and a number another account has verified
// (phone_in_use), so the website sends no SMS for a code that could not be used.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Phone proofs are made through the production service commands
// (create, claim, finalize) as the website's server does; no SMS is sent and no
// OTP key is involved (the HMAC check lives in the website). The script runs
// the update's read-only preflight, checks its refusals, applies it, checks who
// is refused and who is not, and proves apply -> rollback -> apply returns the
// same fingerprints. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-phone-in-use-before-sms.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  applyWithRollbackCheck,
  assertReadOnlyPreflight,
  executeGrants,
  openUpdateCheck,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261116194000_phone_in_use_before_sms.sql";
const [PREFLIGHT, ROLLBACK] = [
  ["preflight", ".check.sql"],
  ["rollback", ".down.sql"],
].map(([folder, suffix]) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8")
);
const CREATE = "internal.create_verification_phone_challenge(uuid,text,text)";
const API_CREATE = "api.create_verification_phone_challenge(uuid,text,text)";
const HELD = "+27710000001";
const FREE = "+27710000002";
const OTHER = "+27710000003";
const NEIGHBOUR = "+27710000004";
const MOVED = "+27710000005";

const {
  started,
  database,
  check,
  current,
  passed: checks,
  q,
  json,
  fails,
  service,
  fingerprint,
  bodyMd5,
  preflightRows: preflight,
  syntheticMember,
} = await openUpdateCheck(PREFLIGHT);
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ------------------------------------------------------- synthetic world
  const hash = () => `h${randomBytes(24).toString("hex")}`;
  const createSql = (owner, phone, digest = hash()) =>
    service(
      `select api.create_verification_phone_challenge('${owner.id}','${phone}','${digest}');`
    );
  const create = (owner, phone) => {
    const digest = hash();
    return { digest, ...json(createSql(owner, phone, digest)) };
  };
  const finalizeSql = (owner, challenge) =>
    service(
      `select api.claim_verification_phone_attempt('${owner.id}','${challenge.challenge_id}');
       select api.finalize_verification_phone('${owner.id}','${challenge.challenge_id}','${challenge.digest}');`
    );
  /** A verified phone for `owner`, made as the website's server does. */
  const prove = (owner, phone) => {
    const challenge = create(owner, phone);
    q(finalizeSql(owner, challenge));
    return q(
      `select id from private.verification_phone_proofs where owner_id='${owner.id}' and revoked_at is null;`
    );
  };
  const challengeCount = (owner) =>
    Number(
      q(`select count(*) from private.verification_phone_challenges where owner_id='${owner.id}';`)
    );
  /** Creating a code for `phone` fails with PT409 and this listed reason. */
  const refused = (owner, phone, reason) => {
    const stderr = fails(createSql(owner, phone), "PT409");
    assert.match(stderr, new RegExp(`DETAIL:\\s+${reason}\\b`), stderr);
    return stderr;
  };
  const activePhones = (owner) =>
    json(
      `select coalesce(jsonb_agg(phone),'[]') from private.verification_phone_proofs where owner_id='${owner.id}' and revoked_at is null;`
    );
  const pendingUntil = (challenge) =>
    q(
      `select expires_at>clock_timestamp() from private.verification_phone_challenges where id='${challenge.challenge_id}';`
    );

  const holder = syntheticMember("phone-holder");
  const newcomer = syntheticMember("phone-newcomer");
  prove(holder, HELD);

  // ------------------------------------------------------------ before
  await check("before the update: a held number gets a code, refused only at the end", () => {
    assert.equal(bodyMd5(CREATE), "3b433478c2e7b15b7889ba5d16e026ad");
    const challenge = create(newcomer, HELD);
    assert.ok(challenge.challenge_id);
    // This is where the SMS would have been paid for.
    fails(finalizeSql(newcomer, challenge), "23505");
    // The holder could also get a code for their own number, and for a change
    // finalization refuses (changed less than 15 days ago).
    assert.ok(create(holder, HELD).challenge_id);
    const change = create(holder, OTHER);
    assert.ok(change.challenge_id);
    fails(finalizeSql(holder, change), "PT409", /contact change not eligible/);
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    // The newcomer's code from the check above is still open.
    assert.equal(
      rows[0][1],
      "phone in use before sms: update not applied; active phone proofs: 1; open codes for a number in use: 1"
    );
    assertReadOnlyPreflight(database, PREFLIGHT);
  });
  await check("drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(`select pg_get_functiondef('${CREATE}'::regprocedure);`);
    // The same function with one more space at the start of its body.
    q(
      `do $$begin execute replace(pg_get_functiondef('${CREATE}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /unexpected state/);
    assert.match(rows[1][1], /create_verification_phone_challenge.* is not the reviewed body/);
    assert.match(fails(step.sql, "55000"), /phone challenge drift/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  const grants = executeGrants(json, [CREATE, API_CREATE]);
  applyWithRollbackCheck(database, {
    step,
    rollback: ROLLBACK,
    label: "phone in use before sms",
    fingerprint,
    preflightRows: preflight,
    appliedSummary:
      /^phone in use before sms: already applied; active phone proofs: 1; open codes for a number in use: 1$/,
  });

  await check("a number another account holds is refused before a challenge is stored", () => {
    const earlier = create(newcomer, OTHER);
    const stored = challengeCount(newcomer);
    refused(newcomer, HELD, "phone_in_use");
    assert.equal(challengeCount(newcomer), stored, "no challenge row");
    assert.equal(pendingUntil(earlier), "t", "the member's open code stays usable");
  });
  await check("the member's own verified number gets no new code", () => {
    const stored = challengeCount(holder);
    refused(holder, HELD, "phone_already_verified");
    assert.equal(challengeCount(holder), stored, "no challenge row");
    assert.deepEqual(activePhones(holder), [HELD]);
  });
  await check("a change within 15 days gets no code, and says from when", () => {
    const stored = challengeCount(holder);
    const allowedFrom = q(
      `select to_char((contact_changed_at+interval '15 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
        from private.verification_phone_proofs where owner_id='${holder.id}' and revoked_at is null;`
    );
    assert.match(allowedFrom, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const stderr = refused(holder, OTHER, "phone_change_cooldown");
    assert.match(stderr, new RegExp(`HINT:\\s+${allowedFrom}`));
    // Eligibility comes first: a member who may not change their number learns
    // nothing about who holds another one.
    prove(syntheticMember("phone-neighbour"), NEIGHBOUR);
    refused(holder, NEIGHBOUR, "phone_change_cooldown");
    assert.equal(challengeCount(holder), stored, "no challenge row");
  });
  await check("a change without a current verified identity gets no code", () => {
    q(
      `update private.verification_phone_proofs set contact_changed_at=clock_timestamp()-interval '16 days'
        where owner_id='${holder.id}' and revoked_at is null;`
    );
    const stored = challengeCount(holder);
    refused(holder, OTHER, "phone_change_identity_required");
    assert.equal(challengeCount(holder), stored, "no challenge row");
    assert.deepEqual(activePhones(holder), [HELD]);
  });
  await check("a free number, and a number released by its holder, still work", () => {
    const freeProof = prove(newcomer, FREE);
    assert.ok(freeProof);
    const leaver = syntheticMember("phone-leaver");
    refused(leaver, HELD, "phone_in_use");
    q(
      `update private.verification_phone_proofs set revoked_at=clock_timestamp() where owner_id='${holder.id}' and revoked_at is null;`
    );
    assert.ok(create(leaver, HELD).challenge_id);
  });
  await check("validation and account checks still come first", () => {
    const stranger = { id: "00000000-0000-4000-8000-0000000000aa" };
    fails(createSql(stranger, FREE), "42501", /active subject required/);
    fails(createSql(holder, "+2771"), "22023", /valid phone challenge required/);
  });
  await check("who may run it is unchanged", () => {
    assert.deepEqual(executeGrants(json, [CREATE, API_CREATE]), grants);
    assert.deepEqual(grants[API_CREATE], {
      anon: false,
      authenticated: false,
      service_role: true,
    });
    const meta =
      json(`select jsonb_build_object('definer',prosecdef,'owner',proowner::regrole::text,'config',proconfig)
        from pg_proc where oid='${CREATE}'::regprocedure;`);
    assert.deepEqual(meta, {
      definer: true,
      owner: "postgres",
      config: ["search_path=pg_catalog"],
    });
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep refusing a held number before any SMS", () => {
      const keeper = syntheticMember("phone-keeper");
      const seeker = syntheticMember("phone-seeker");
      prove(keeper, "+27710000009");
      refused(seeker, "+27710000009", "phone_in_use");
      refused(keeper, "+27710000009", "phone_already_verified");
    });
  }

  // Last, because it replaces internal.current_verified_identity with a
  // stand-in (an accepted identity is out of scope here): an allowed change of
  // number still gets a code and is verified.
  await check("an allowed change of number still gets a code and is verified", () => {
    const mover = syntheticMember("phone-mover");
    prove(mover, "+27710000006");
    q(`create or replace function internal.current_verified_identity(p_owner uuid) returns text
        language sql set search_path to 'pg_catalog' as $fn$
        select 'stand-in' where p_owner='${mover.id}' $fn$;`);
    refused(mover, MOVED, "phone_change_cooldown");
    q(
      `update private.verification_phone_proofs set contact_changed_at=clock_timestamp()-interval '16 days'
        where owner_id='${mover.id}' and revoked_at is null;`
    );
    const change = create(mover, MOVED);
    assert.ok(change.challenge_id);
    q(finalizeSql(mover, change));
    assert.deepEqual(activePhones(mover), [MOVED]);
    // The new number starts a new 15 days.
    refused(mover, "+27710000006", "phone_change_cooldown");
  });
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Phone in use before SMS checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);

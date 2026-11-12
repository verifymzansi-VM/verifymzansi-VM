#!/usr/bin/env node
// Behaviour checks for 20261112122001_publish_posting_terms_v4.sql: posting-v4
// (Pricing v2, roadmap P1) is published ahead of time and NOT made current.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members call the production posting terms commands as `authenticated`
// with synthetic claims and a live session row. The script runs the update's
// read-only preflight, checks that the update refuses an unexpected current
// version or a different posting-v4 document, applies it, and checks that
// posting-v3 stays current: members who accepted posting-v3 keep their
// acceptance, nobody can accept posting-v4 yet, and the posting-v4 row is
// immutable. It proves that apply -> rollback -> apply leaves the schema
// fingerprint unchanged (the update writes one reference row only). Any later
// updates are applied at the end. Finally it simulates the later, separately
// reviewed switch (posting-v4 made current) to show that every member is then
// asked to accept posting-v4 once and that this file's rollback refuses.
//
//   node --import tsx scripts/test-foundation-posting-terms-v4.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyStepsBefore,
  assertReadOnlyPreflight,
  createChecks,
  sqlHelpers,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261112122001_publish_posting_terms_v4.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const CATALOGUE = JSON.parse(readFileSync("src/lib/legal/terms-documents/catalogue.json", "utf8"));
const DOCUMENT = JSON.parse(readFileSync("src/lib/legal/terms-documents/posting-v4.json", "utf8"));
const V3 = { version: "posting-v3", document_hash: CATALOGUE.versions["posting-v3"] };
const V4 = { version: "posting-v4", document_hash: CATALOGUE.versions["posting-v4"] };
const OTHER_HASH = "B".repeat(43);

const { check, current, passed: checks } = createChecks();

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  // ---------------------------------------------------------------- helpers
  const { run, q, json, fails, member } = sqlHelpers(database, current);
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const currentTerms = () =>
    json(
      "select jsonb_build_object('version',v.version,'document_hash',v.document_hash) from private.posting_terms_current c join private.posting_terms_versions v using(version) where c.singleton;"
    );
  const publicTerms = () => json("set role anon;\nselect api.get_current_posting_terms();");
  const v4Rows = () =>
    json(
      "select coalesce(jsonb_agg(document_hash),'[]') from private.posting_terms_versions where version='posting-v4';"
    );
  const setCurrent = (version) =>
    q(`update private.posting_terms_current set version='${version}' where singleton;`);
  /** Removes a posting-v4 row planted by a check (published rows are immutable). */
  const removeV4 = () =>
    q(`alter table private.posting_terms_versions disable trigger posting_terms_document_immutable;
       delete from private.posting_terms_versions where version='posting-v4';
       alter table private.posting_terms_versions enable trigger posting_terms_document_immutable;`);

  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid);
    end$$;`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const ownerTerms = (owner) => json(member(owner, "select api.get_owner_posting_terms();"));
  const accept = (owner, terms) =>
    json(
      member(owner, `select api.accept_posting_terms('${terms.version}','${terms.document_hash}');`)
    );
  const acceptSql = (owner, terms) =>
    member(owner, `select api.accept_posting_terms('${terms.version}','${terms.document_hash}');`);

  // ------------------------------------------------------------ before
  const early = user("early");
  await check("the shipped posting-v4 document is the one the update publishes", () => {
    assert.equal(CATALOGUE.active_version, "posting-v3");
    assert.equal(DOCUMENT.version, "posting-v4");
    assert.equal(
      createHash("sha256").update(JSON.stringify(DOCUMENT)).digest("base64url"),
      V4.document_hash
    );
    assert.ok(step.sql.includes(`values('posting-v4','${V4.document_hash}')`));
    // The update never names a current version: it cannot make posting-v4 current.
    assert.doesNotMatch(step.sql, /update\s+private\.posting_terms_current/i);
  });
  const before = fingerprint();
  await check("before the update: posting-v3 is current and posting-v4 is unknown", () => {
    assert.deepEqual(currentTerms(), V3);
    assert.deepEqual(v4Rows(), []);
    assert.equal(accept(early, V3).version, "posting-v3");
    fails(acceptSql(early, V4), "PT409", /posting terms changed/);
  });
  await check("preflight: read only, summary only, before the update", () => {
    assertReadOnlyPreflight(database, PREFLIGHT);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "current posting-v3; accounts that accepted it: 1; posting-v4 not published (update not applied); accounts that accepted posting-v4: 0"
    );
  });
  await check("the update refuses an unexpected current version and changes nothing", () => {
    setCurrent("posting-v1");
    assert.match(preflight()[1][1], /current posting terms are posting-v1, expected posting-v3/);
    fails(step.sql, "55000", /expected posting-v3/);
    assert.deepEqual(v4Rows(), []);
    setCurrent("posting-v3");
    assert.deepEqual(currentTerms(), V3);
  });
  await check("the update refuses a posting-v4 already published with another document", () => {
    q(
      `insert into private.posting_terms_versions(version,document_hash) values('posting-v4','${OTHER_HASH}');`
    );
    const rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[0][1], /posting-v4 published with a different document/);
    assert.equal(rows[1][1], "posting-v4 is already published with a different document");
    fails(step.sql, "55000", /already published with a different document/);
    assert.deepEqual(v4Rows(), [OTHER_HASH]);
    removeV4();
    assert.deepEqual(v4Rows(), []);
    assert.equal(fingerprint(), before);
  });
  await check("a rollback before the update changes nothing", () => {
    applySteps(database, [{ label: "posting terms v4 rollback before", sql: ROLLBACK }]);
    assert.deepEqual(v4Rows(), []);
    assert.equal(fingerprint(), before);
  });

  // ------------------------------------------------------------- apply
  applySteps(database, [step]);

  await check(
    "after the update: posting-v4 is published with its hash, posting-v3 stays current",
    () => {
      assert.deepEqual(v4Rows(), [V4.document_hash]);
      assert.deepEqual(currentTerms(), V3);
      assert.deepEqual(publicTerms(), { ...V3, document_path: "/terms/versions/posting-v3" });
      assert.equal(fingerprint(), before, "the update changes no schema object");
      const rows = preflight();
      assert.deepEqual(
        rows.map((r) => r[0]),
        ["summary"],
        JSON.stringify(rows)
      );
      assert.equal(
        rows[0][1],
        "current posting-v3; accounts that accepted it: 1; posting-v4 published (update already applied); accounts that accepted posting-v4: 0"
      );
    }
  );
  await check("members keep their posting-v3 acceptance and cannot accept posting-v4 yet", () => {
    const kept = ownerTerms(early);
    assert.equal(kept.version, "posting-v3");
    assert.notEqual(kept.accepted_at, null, "no new acceptance is asked for");
    fails(acceptSql(early, V4), "PT409", /posting terms changed/);
    const late = user("late");
    assert.equal(ownerTerms(late).accepted_at, null);
    fails(acceptSql(late, V4), "PT409", /posting terms changed/);
    assert.equal(accept(late, V3).version, "posting-v3");
    assert.equal(
      q("select count(*) from private.posting_terms_acceptances where version='posting-v4';"),
      "0"
    );
  });
  await check("the published posting-v4 row cannot be changed or deleted", () => {
    fails(
      "update private.posting_terms_versions set document_hash=document_hash where version='posting-v4';",
      "23514"
    );
    fails("delete from private.posting_terms_versions where version='posting-v4';", "23514");
    assert.deepEqual(v4Rows(), [V4.document_hash]);
  });
  await check("apply -> rollback -> apply leaves everything as it was", () => {
    applySteps(database, [{ label: "posting terms v4 rollback", sql: ROLLBACK }]);
    assert.deepEqual(v4Rows(), [V4.document_hash], "published terms stay");
    assert.deepEqual(currentTerms(), V3);
    assert.equal(fingerprint(), before);
    applySteps(database, [step]);
    applySteps(database, [step]);
    assert.deepEqual(v4Rows(), [V4.document_hash]);
    assert.deepEqual(currentTerms(), V3);
    assert.equal(fingerprint(), before, "a repeated run changes nothing");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep posting-v3 current and posting-v4 published", () => {
      assert.deepEqual(currentTerms(), V3);
      assert.deepEqual(v4Rows(), [V4.document_hash]);
    });
  }

  // --------------------------------- the later switch (simulated here only)
  await check("once a later update makes posting-v4 current, every member accepts it once", () => {
    setCurrent("posting-v4");
    assert.deepEqual(publicTerms(), { ...V4, document_path: "/terms/versions/posting-v4" });
    const asked = ownerTerms(early);
    assert.equal(asked.version, "posting-v4");
    assert.equal(asked.accepted_at, null, "posting-v3 acceptance does not carry over");
    fails(acceptSql(early, V3), "PT409", /posting terms changed/);
    const accepted = accept(early, V4);
    assert.equal(accepted.version, "posting-v4");
    assert.notEqual(accepted.accepted_at, null);
    // Re-running this file after the switch is harmless and keeps posting-v4.
    applySteps(database, [step]);
    assert.deepEqual(currentTerms(), V4);
    // This file's rollback refuses while posting-v4 is current.
    const result = run(ROLLBACK);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /posting-v4 is the current posting terms/);
    assert.deepEqual(currentTerms(), V4);
  });
} catch (error) {
  console.error(`FAIL ${current()}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Posting terms v4 checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);

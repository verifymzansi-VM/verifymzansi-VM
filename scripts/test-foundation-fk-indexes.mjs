#!/usr/bin/env node
// Behaviour checks for 20261111223723_foreign_key_indexes.sql: indexes for the
// foreign keys used by deletion and the retention sweep.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate and runs the query behind the Supabase performance advisor's
// "unindexed foreign keys" finding (a foreign key whose columns are not the
// leading columns of any valid index) before and after the update. It checks
// that the read-only preflight writes nothing, that the update refuses a
// duplicate or conflicting index, that the foreign key lookups Postgres runs
// on delete use each new index, that the rollback drops exactly these
// indexes, and that apply -> rollback -> apply returns the schema fingerprint
// to the same values each time. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-fk-indexes.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replaySteps } from "./lib/foundation-replay.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261111223723_foreign_key_indexes.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");

/** Same rule as the advisor: no valid index starts with the key's columns, in order. */
const UNINDEXED = `
select string_agg(format('%s(%s)', c.conrelid::regclass,
    (select string_agg(a.attname, ',' order by k.o) from unnest(c.conkey) with ordinality k(n, o)
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n)), E'\\n' order by 1)
from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace s on s.oid = t.relnamespace
where c.contype = 'f' and s.nspname in ('public', 'api', 'private', 'internal')
  and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
    and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey);`;

/** Keys the update deliberately leaves unindexed (see the update's header). */
const LEFT_UNINDEXED = [
  // An existing index already serves the lookup through a unique or selective
  // leading column.
  "private.accepted_identity_facts(submission_id,owner_id)",
  "private.business_details(post_id,post_kind)",
  "private.event_details(post_id,post_kind)",
  "private.evidence_artifacts(case_id,owner_id)",
  "private.frontend_business_checks(id,owner_id)",
  "private.frontend_verification_uploads(case_id,owner_id)",
  "private.identity_submission_names(submission_id,owner_id)",
  "private.listing_details(post_id,post_kind)",
  "private.organisation_affiliations(post_id,post_kind)",
  "private.organisation_applications(post_id,post_kind)",
  "private.post_contacts(post_id,post_kind)",
  "private.verification_identity_submissions(case_id,owner_id)",
  "private.verification_phone_proofs(challenge_id,owner_id)",
  // Reference tables that no command deletes or re-keys.
  "private.categories(reference_version)",
  "private.cities(province_id)",
  "private.event_details(timezone)",
  "private.listing_details(attributes_version)",
  "private.organisations(province_id)",
  "private.payments(addon_version_id)",
  "private.payments(plan_version_id)",
  "private.post_search_documents(category_key,activity_key)",
  "private.post_search_documents(category_key,kind,area)",
  "private.post_search_documents(city_id,province_id)",
  "private.posting_terms_acceptances(version,document_hash)",
  "private.posting_terms_current(version)",
  "private.posts(category_key,activity_key)",
  "private.posts(category_key,kind,area)",
  "private.posts(city_id,province_id)",
  "private.posts(province_id)",
  "private.programme_showcases(city_id)",
  "private.programme_showcases(province_id)",
  "private.verification_localities(city_id,province_id)",
  // Organisation programmes, which no command deletes.
  "private.organisation_affiliations(programme_id,organisation_id)",
  "private.organisation_applications(programme_id,organisation_id)",
  "private.programme_showcases(programme_id,organisation_id)",
].sort();

const checks = [];
let current = "start";
async function check(id, fn) {
  current = id;
  await fn();
  checks.push(id);
  console.log(`PASS ${id}`);
}

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps } = replaySteps();
  const index = steps.findIndex((step) => step.label === UPDATE);
  assert.ok(index > 0, `${UPDATE} is missing`);
  const step = steps[index];
  applySteps(database, steps.slice(0, index));

  const run = (sql) => database.psql(`\\set VERBOSITY verbose\n${sql}`, ["-A", "-t"]);
  const q = (sql) => {
    const result = run(sql);
    if (result.status !== 0) throw new Error(`[${current}] SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  /** Runs a whole file that must fail with `state`; returns the error text. */
  const refused = (sql, state, message) => {
    const result = run(sql);
    assert.notEqual(result.status, 0, `[${current}] expected ${state}, it succeeded`);
    assert.equal(/ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1], state, result.stderr);
    assert.match(result.stderr, message);
  };
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const unindexed = () => q(UNINDEXED).split("\n").filter(Boolean);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));

  // The indexes, as the update writes them out.
  const created = [
    ...step.sql.matchAll(
      /^create index if not exists (\w+) on private\.(\w+) \((\w+)\)( where \3 is not null)?;$/gm
    ),
  ].map(([, name, table, column, partial]) => ({
    name,
    table,
    column,
    definition: `CREATE INDEX ${name} ON private.${table} USING btree (${column})${partial ? ` WHERE (${column} IS NOT NULL)` : ""}`,
  }));
  const definitionOf = (name) =>
    q(`select coalesce(pg_get_indexdef(to_regclass('private.${name}')),'missing');`);
  const present = () => created.filter((x) => definitionOf(x.name) === x.definition).length;
  /** The plan of the lookup Postgres runs on child(column) when a parent row is
   * deleted, as a generic plan (the value is a parameter, as in the trigger),
   * with sequential scans discouraged so any usable index is chosen. */
  const lookupPlan = (x) =>
    q(`set plan_cache_mode = force_generic_plan;
      set enable_seqscan = off;
      prepare lookup as select 1 from only private.${x.table} x where $1 operator(pg_catalog.=) x.${x.column} for key share of x;
      explain (costs off) execute lookup(null);`);

  // ------------------------------------------------------------ before
  const original = fingerprint();
  await check("the four lists of the update and its companions agree", () => {
    assert.equal(created.length, 39);
    assert.equal(new Set(created.map((x) => x.name)).size, created.length);
    const triples = created.map((x) => {
      const partial = x.definition.includes(" WHERE ");
      return `('${x.table}', '${x.column}', ${partial})`;
    });
    const pairs = created.map((x) => `('${x.name}', '${x.definition}')`);
    for (const triple of triples) {
      assert.equal(step.sql.split(triple).length, 2, `update precondition lists ${triple}`);
      assert.equal(PREFLIGHT.split(triple).length, 2, `preflight lists ${triple}`);
    }
    for (const pair of pairs) {
      assert.equal(step.sql.split(pair).length, 2, `update post-check lists ${pair}`);
      assert.equal(ROLLBACK.split(pair).length, 2, `rollback lists ${pair}`);
    }
    const drops = [...ROLLBACK.matchAll(/^drop index if exists private\.(\w+);$/gm)].map(
      (m) => m[1]
    );
    assert.deepEqual(
      drops,
      created.map((x) => x.name)
    );
    for (const sql of [step.sql, PREFLIGHT, ROLLBACK])
      assert.equal(
        sql.match(/\('\w+', '\w+', (true|false)\)/g)?.length ?? 0,
        sql === ROLLBACK ? 0 : 39
      );
  });
  await check("before the update: 74 unindexed keys, including every key it indexes", () => {
    const keys = unindexed();
    assert.equal(keys.length, 74, keys.join("\n"));
    const indexed = created.map((x) => `private.${x.table}(${x.column})`);
    for (const key of indexed) assert.ok(keys.includes(key), `${key} is unindexed before`);
    assert.deepEqual(keys.filter((key) => !indexed.includes(key)).sort(), LEFT_UNINDEXED);
    assert.equal(present(), 0);
    for (const x of created) assert.match(lookupPlan(x), /Seq Scan on/, x.name);
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((row) => row[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^foreign key indexes: not applied .*; present 0 of 39; size of the 25 tables: /
    );
    const write = database.psql(`${PREFLIGHT}\ncreate table private.vmtest_marker(id uuid);`, [
      "-A",
      "-t",
      "-1",
      "-v",
      "VERBOSITY=verbose",
    ]);
    assert.notEqual(write.status, 0);
    assert.match(write.stderr, /ERROR:\s+25006:/);
    assert.equal(fingerprint(), original);
  });
  await check("index commands do not fire the row level security event trigger", () => {
    const tags = q(
      `select array_to_string(evttags, ',') from pg_event_trigger where evtname='require_table_rls';`
    );
    assert.match(tags, /CREATE TABLE/);
    assert.doesNotMatch(tags, /INDEX/);
  });
  await check("an index under another name, or one of its names in use, is refused", () => {
    q("create index vmtest_other on private.moderation_log (staff_id, decided_at);");
    let rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(
      rows[1][1],
      /private\.moderation_log\(staff_id\) is already indexed by private\.vmtest_other/
    );
    refused(step.sql, "55000", /already indexed by private\.vmtest_other/);
    assert.equal(present(), 0, "nothing was created");
    q("drop index private.vmtest_other;");

    q("create index decisions_proposed_by_idx on private.decisions (proposed_by, id);");
    rows = preflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /private\.decisions_proposed_by_idx exists with another definition/);
    refused(step.sql, "55000", /decisions_proposed_by_idx exists with another definition/);
    refused(ROLLBACK, "55000", /decisions_proposed_by_idx has another definition/);
    assert.equal(
      definitionOf("decisions_proposed_by_idx"),
      "CREATE INDEX decisions_proposed_by_idx ON private.decisions USING btree (proposed_by, id)"
    );
    q("drop index private.decisions_proposed_by_idx;");
    assert.equal(fingerprint(), original);
  });
  await check("a rollback before the update changes nothing", () => {
    applySteps(database, [{ label: "rollback before the update", sql: ROLLBACK }]);
    assert.equal(fingerprint(), original);
  });

  // ------------------------------------------------------------- apply
  applySteps(database, [step]);
  const after = fingerprint();

  await check(
    "after the update: every index as written; only the documented keys stay unindexed",
    () => {
      for (const x of created) assert.equal(definitionOf(x.name), x.definition);
      assert.deepEqual(unindexed().sort(), LEFT_UNINDEXED);
      assert.deepEqual(preflight(), [["summary", preflight()[0][1]]]);
      assert.match(preflight()[0][1], /^foreign key indexes: already applied; present 39 of 39; /);
      assert.equal(
        q(`select count(*) from pg_class t join pg_namespace n on n.oid=t.relnamespace
         where n.nspname in ('public','api','private','internal') and t.relkind in ('r','p') and not t.relrowsecurity;`),
        "0"
      );
    }
  );
  await check("the lookups Postgres runs for a deleted parent use the new indexes", () => {
    for (const x of created) {
      const plan = lookupPlan(x);
      assert.match(
        plan,
        new RegExp(`(Index|Index Only|Bitmap Index) Scan (using|on) ${x.name}\\b`),
        `${x.name}:\n${plan}`
      );
    }
  });
  await check("deleting an Auth user still checks the keys", () => {
    const user = () =>
      q(
        `insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'fk-'||gen_random_uuid()||'@example.invalid',now()) returning id;`
      ).split("\n")[0];
    const [member, staff, other] = [user(), user(), user()];
    q(
      `insert into private.legal_holds(subject_id,placed_by,reason) values('${member}','${staff}','synthetic hold');`
    );
    // legal_holds.placed_by is ON DELETE RESTRICT: still refused.
    refused(`delete from auth.users where id='${staff}';`, "23503", /legal_holds_placed_by_fkey/);
    q(`delete from auth.users where id='${other}';`);
    assert.equal(q(`select count(*) from auth.users where id='${other}';`), "0");
  });
  await check("partly applied is reported, and running the update again completes it", () => {
    q("drop index private.reports_resolved_by_idx;");
    const rows = preflight();
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.match(rows[0][1], /^foreign key indexes: partly applied; present 38 of 39; /);
    applySteps(database, [step]);
    assert.equal(fingerprint(), after);
  });
  await check("apply -> rollback -> apply gives the same schema each time", () => {
    applySteps(database, [{ label: "foreign key index rollback", sql: ROLLBACK }]);
    assert.equal(fingerprint(), original, "the rollback leaves the pre-update schema");
    assert.equal(unindexed().length, 74);
    assert.match(preflight()[0][1], /^foreign key indexes: not applied /);
    applySteps(database, [{ label: "foreign key index rollback again", sql: ROLLBACK }]);
    assert.equal(fingerprint(), original, "a repeated rollback changes nothing");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    applySteps(database, [step]);
    assert.equal(fingerprint(), after, "a repeated run changes nothing");
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep every index", () => {
      for (const x of created) assert.equal(definitionOf(x.name), x.definition);
    });
  }
} catch (error) {
  console.error(`FAIL ${current}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Foreign key index checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);

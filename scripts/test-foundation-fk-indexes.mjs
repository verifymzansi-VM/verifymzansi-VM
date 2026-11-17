#!/usr/bin/env node
// Behaviour checks for 20261111223723_foreign_key_indexes.sql: indexes for the
// foreign keys used by deletion and the retention sweep.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Before and after the update it runs two checks over every foreign key
// of the application schemas:
// - the rule of the Supabase performance advisor's "unindexed foreign keys"
//   finding (no valid index starts with the key's columns, in order), restricted
//   to the application schemas;
// - the plan of the lookup Postgres runs on the referencing table when a
//   referenced row is deleted, as a generic plan (the value is a parameter, as
//   in the trigger) with sequential scans discouraged: the key is served only
//   when an index condition is used on an index whose first column is one of
//   the key's columns. This also sees keys the advisor counts as indexed
//   because a partial index for some rows starts with the column.
// It then checks that the read-only preflight writes nothing, that the update
// and the rollback refuse a duplicate or conflicting index, that a partly
// applied update is completed by running it again, that the rollback drops
// exactly these indexes, and that apply -> rollback -> apply returns the schema
// fingerprint to the same values each time. Any later updates are applied at
// the end.
//
//   node --import tsx scripts/test-foundation-fk-indexes.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyStepsBefore } from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261111223723_foreign_key_indexes.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const COUNT = 50;

/** Every foreign key of the application schemas: "table|col,col|advisor". */
const FOREIGN_KEYS = `
select string_agg(format('%s|%s|%s', c.conrelid::regclass,
    (select string_agg(a.attname, ',' order by k.o) from unnest(c.conkey) with ordinality k(n, o)
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n),
    not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
      and (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey)),
  E'\\n' order by c.conrelid::regclass::text, c.conname)
from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace s on s.oid = t.relnamespace
where c.contype = 'f' and s.nspname in ('public', 'api', 'private', 'internal');`;

/** Composite keys the advisor lists that an existing index already serves
 * through a unique or selective leading column (the plan check proves it). */
const SERVED_BY_EXISTING = [
  "private.accepted_identity_facts(submission_id,owner_id)",
  "private.business_details(post_id,post_kind)",
  "private.event_details(post_id,post_kind)",
  "private.evidence_artifacts(case_id,owner_id)",
  "private.frontend_business_checks(id,owner_id)",
  "private.frontend_verification_uploads(case_id,owner_id)",
  "private.identity_submission_names(submission_id,owner_id)",
  "private.listing_details(post_id,post_kind)",
  "private.organisation_applications(post_id,post_kind)",
  "private.post_contacts(post_id,post_kind)",
  "private.verification_identity_submissions(case_id,owner_id)",
  "private.verification_phone_proofs(challenge_id,owner_id)",
];

/** Keys the advisor lists that the update deliberately leaves unindexed. */
const LEFT_UNINDEXED = [
  ...SERVED_BY_EXISTING,
  ...[
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
  ],
].sort();

/** Keys whose delete lookup still reads the table (or a whole index) after
 * the update: their parents are reference tables or organisations, which no
 * command deletes. */
const SCANNED_ON_PURPOSE = [
  "private.categories(reference_version)",
  "private.cities(province_id)",
  "private.event_details(timezone)",
  "private.listing_details(attributes_version)",
  "private.organisation_invites(organisation_id)",
  "private.organisations(province_id)",
  "private.payments(addon_version_id)",
  "private.payments(plan_version_id)",
  "private.post_search_documents(category_key)",
  "private.post_search_documents(category_key,activity_key)",
  "private.post_search_documents(category_key,kind,area)",
  "private.post_search_documents(city_id,province_id)",
  "private.post_search_documents(province_id)",
  "private.posting_terms_acceptances(version,document_hash)",
  "private.posting_terms_current(version)",
  "private.posts(category_key,activity_key)",
  "private.posts(category_key,kind,area)",
  "private.posts(city_id,province_id)",
  "private.posts(province_id)",
  "private.programme_showcases(city_id)",
  "private.programme_showcases(province_id)",
  "private.verification_localities(city_id,province_id)",
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
  const { steps, index, step } = applyStepsBefore(database, UPDATE);

  const run = (sql) => database.psql(`\\set VERBOSITY verbose\n${sql}`, ["-A", "-t"]);
  const q = (sql) => {
    const result = run(sql);
    if (result.status !== 0) throw new Error(`[${current}] SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  /** Runs SQL that must fail with `state` and a message matching `message`. */
  const refused = (sql, state, message) => {
    const result = run(sql);
    assert.notEqual(result.status, 0, `[${current}] expected ${state}, it succeeded`);
    assert.equal(/ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1], state, result.stderr);
    assert.match(result.stderr, message);
  };
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));

  const foreignKeys = () =>
    q(FOREIGN_KEYS)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [table, columns, advisor] = line.split("|");
        return { key: `${table}(${columns})`, table, columns: columns.split(","), advisor };
      });
  /** Keys the advisor lists as unindexed. */
  const unindexed = () =>
    foreignKeys()
      .filter((fk) => fk.advisor === "t")
      .map((fk) => fk.key)
      .sort();
  /** For each key, the index its delete lookup uses with an index condition
   * (null when it reads the whole table), in one psql session. */
  const lookups = () => {
    const keys = foreignKeys();
    const marker = "@@lookup ";
    const script = keys
      .map((fk, n) => {
        const where = fk.columns.map((c, i) => `$${i + 1} operator(pg_catalog.=) x.${c}`);
        const nulls = fk.columns.map(() => "null").join(",");
        return `\\echo '${marker}${n}'
deallocate all;
prepare lookup as select 1 from only ${fk.table} x where ${where.join(" and ")} for key share of x;
explain (costs off) execute lookup(${nulls});`;
      })
      .join("\n");
    const output = q(`set plan_cache_mode = force_generic_plan;
set enable_seqscan = off;
${script}`);
    const plans = output.split(marker).slice(1);
    assert.equal(plans.length, keys.length);
    const used = new Map();
    for (const [n, plan] of plans.map((text) => [Number(text.split("\n")[0]), text])) {
      const name = /(?:Index Scan|Index Only Scan|Bitmap Index Scan) (?:using|on) (\w+)/.exec(
        plan
      )?.[1];
      used.set(keys[n].key, plan.includes("Index Cond") && name ? name : null);
    }
    const names = [...new Set([...used.values()].filter(Boolean))];
    const firstColumn = new Map(
      q(`select string_agg(c.relname || '|' || a.attname, E'\\n') from pg_index i
           join pg_class c on c.oid = i.indexrelid
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
           where c.relname = any(array[${names.map((name) => `'${name}'`).join(",")}]::text[]);`)
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("|"))
    );
    return keys.map((fk) => {
      const name = used.get(fk.key);
      return {
        key: fk.key,
        index: name && fk.columns.includes(firstColumn.get(name)) ? name : null,
      };
    });
  };
  const scanned = (result) =>
    result
      .filter((lookup) => !lookup.index)
      .map((lookup) => lookup.key)
      .sort();

  // The indexes, as the update writes them out.
  const created = [
    ...step.sql.matchAll(
      /^create index if not exists (\w+) on private\.(\w+) \(([\w, ]+)\)( where \3 is not null)?;$/gm
    ),
  ].map(([, name, table, columns, partial]) => ({
    name,
    table,
    columns,
    partial: Boolean(partial),
    key: `private.${table}(${columns.replace(", ", ",")})`,
    definition: `CREATE INDEX ${name} ON private.${table} USING btree (${columns})${partial ? ` WHERE (${columns} IS NOT NULL)` : ""}`,
  }));
  const definitionOf = (name) =>
    q(`select coalesce(pg_get_indexdef(to_regclass('private.${name}')),'missing');`);
  const present = () => created.filter((x) => definitionOf(x.name) === x.definition).length;

  // ------------------------------------------------------------ before
  const original = fingerprint();
  await check("the lists of the update and its companions agree", () => {
    assert.equal(created.length, COUNT);
    assert.equal(new Set(created.map((x) => x.name)).size, COUNT);
    assert.equal(new Set(created.map((x) => x.key)).size, COUNT);
    for (const x of created) {
      const triple = `('${x.table}', '${x.columns}', ${x.partial})`;
      const pair = `('${x.name}', '${x.definition}')`;
      assert.equal(step.sql.split(triple).length, 2, `update precondition lists ${triple}`);
      assert.equal(PREFLIGHT.split(triple).length, 2, `preflight lists ${triple}`);
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
    const triples = /\('\w+', '[\w, ]+', (true|false)\)/g;
    assert.equal(step.sql.match(triples)?.length, COUNT);
    assert.equal(PREFLIGHT.match(triples)?.length, COUNT);
    assert.equal(ROLLBACK.match(triples), null);
  });
  await check(
    "before the update: the advisor lists 74 keys; every key the update indexes is scanned",
    () => {
      const keys = unindexed();
      assert.equal(keys.length, 74, keys.join("\n"));
      const indexed = created.map((x) => x.key);
      assert.deepEqual(keys.filter((key) => !indexed.includes(key)).sort(), LEFT_UNINDEXED);
      // 40 of the update's keys are on the advisor's list; 10 are not, because a
      // partial index for some rows starts with the column.
      assert.equal(indexed.filter((key) => keys.includes(key)).length, 40);
      assert.deepEqual(scanned(lookups()), [...SCANNED_ON_PURPOSE, ...indexed].sort());
      assert.equal(present(), 0);
    }
  );
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((row) => row[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^foreign key indexes: not applied .*; present 0 of 50; size of the 31 tables: /
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
  await check("an index that already serves a key, or one of the names in use, is refused", () => {
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

    // A partial index for some rows does not serve the key; one for every row
    // with a value does.
    q(
      "create index vmtest_partial on private.decisions (approved_by) where approved_by is not null;"
    );
    assert.match(
      preflight()[1][1],
      /decisions\(approved_by\) is already indexed by private\.vmtest_partial/
    );
    q("drop index private.vmtest_partial;");
    assert.equal(preflight().length, 1, "legal_holds_active_idx (released_at is null) is ignored");

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

    // An invalid index under the update's name (as a failed concurrent build
    // leaves it) is refused, not counted as present.
    q(`create index decisions_proposed_by_idx on private.decisions (proposed_by);
       update pg_index set indisvalid = false where indexrelid = 'private.decisions_proposed_by_idx'::regclass;`);
    rows = preflight();
    assert.match(rows[0][1], /present 0 of 50/);
    assert.match(rows[1][1], /decisions_proposed_by_idx is invalid/);
    refused(step.sql, "55000", /decisions_proposed_by_idx is invalid/);
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
      assert.deepEqual(unindexed(), LEFT_UNINDEXED);
      const rows = preflight();
      assert.equal(rows.length, 1, JSON.stringify(rows));
      assert.match(rows[0][1], /^foreign key indexes: already applied; present 50 of 50; /);
      assert.equal(
        q(`select count(*) from pg_class t join pg_namespace n on n.oid=t.relnamespace
         where n.nspname in ('public','api','private','internal') and t.relkind in ('r','p') and not t.relrowsecurity;`),
        "0"
      );
    }
  );
  await check("every delete lookup uses an index, except the documented reference keys", () => {
    const result = lookups();
    assert.deepEqual(scanned(result), SCANNED_ON_PURPOSE);
    for (const x of created)
      assert.equal(result.find((lookup) => lookup.key === x.key)?.index, x.name, x.key);
    // The composite keys left to existing indexes are served by them.
    for (const key of SERVED_BY_EXISTING)
      assert.ok(result.find((lookup) => lookup.key === key)?.index, key);
  });
  await check("deleting an Auth user still enforces the keys", () => {
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
    assert.match(rows[0][1], /^foreign key indexes: partly applied; present 49 of 50; /);
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

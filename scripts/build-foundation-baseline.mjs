import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { FIXTURE_MIGRATIONS } from "./lib/foundation-native-isolation.mjs";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";
import { assertUnreleasedBaselineGuard } from "./lib/foundation-baseline-guard.mjs";

// Local assembly only. No CLI/network/DB execution and no environment loading.
// A passing prototype run establishes input provenance, not baseline acceptance.
const root = process.cwd();
const evidencePath = process.argv[2];
assert.equal(process.argv.length, 3, "Provide one recorded native results path");
assert.match(evidencePath, /^docs\/backend-foundation\/evidence\/native-[\dTZ.-]+\/results\.json$/);
assertFixturePath(root, evidencePath, { type: "file" });
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
assert.equal(evidence.status, "PASS");
assert.equal(evidence.fixtureProject, "backend-foundation-impl");
assert.equal(evidence.releaseReady, false);
const workspace = "database/foundation";
assertFixturePath(root, workspace, { type: "directory" });
assertFixturePath(root, `${workspace}/supabase/migrations`, { type: "directory" });
assert.equal(
  existsSync(`${workspace}/supabase/.temp/project-ref`),
  false,
  "Linked workspace prohibited"
);
const migrations = readdirSync(`${workspace}/supabase/migrations`);
assert.equal(migrations.length, 1);
assert.match(migrations[0], /^\d{14}_unreleased_foundation\.sql$/);
assertFixturePath(root, `${workspace}/supabase/migrations/${migrations[0]}`, { type: "file" });
const gate = readFileSync(`${workspace}/supabase/migrations/${migrations[0]}`, "utf8");
assertUnreleasedBaselineGuard(gate);
const digest = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const identitiesPath = `${workspace}/catalogue-identities.json`;
assertFixturePath(root, identitiesPath, { type: "file" });
const identities = JSON.parse(readFileSync(identitiesPath, "utf8"));
assert.equal(identities.schemaVersion, 1);
assert.equal(Object.keys(identities.plans).length, 17);
assert.equal(Object.keys(identities.addons).length, 3);
const allIds = [...Object.values(identities.plans), ...Object.values(identities.addons)];
assert.equal(new Set(allIds).size, 20);
for (const id of allIds) assert.match(id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const identityCase = (kind, column) =>
  `case seed.${column}||'@'||seed.version::text ${Object.entries(identities[kind])
    .map(([key, id]) => {
      assert.match(key, /^[a-z0-9_]+@[1-9][0-9]*$/);
      return `when '${key}' then '${id}'::uuid`;
    })
    .join(" ")} else null end`;
const sourceHashes = {};
const modules = [];
const modifiedBodies = new Map();
// CLI replays migration filenames in order, regardless of object insertion order.
for (const [, file] of Object.entries(FIXTURE_MIGRATIONS).sort(([a], [b]) => a.localeCompare(b))) {
  const bytes = readFileSync(file);
  assert.equal(digest(bytes), evidence.provenance[file], `Unverified source: ${file}`);
  sourceHashes[file] = digest(bytes);
  if (file.endsWith("/fixture-core-drivers.sql")) {
    assert.equal([...bytes.toString("utf8").matchAll(/create function api\./g)].length, 2);
    continue;
  }
  // Preserve original body bytes: PostgreSQL stores CRLF inside dollar quotes.
  let sql = bytes.toString("utf8");
  if (file.endsWith("/transport.sql")) {
    const start = sql.indexOf("create schema api;");
    const end = sql.indexOf("create table private.transport_resources (");
    assert.ok(start >= 0 && end > start);
    sql = sql.slice(start, end);
  }
  if (file.endsWith("/post-integrity.sql")) {
    const matches = [
      ...sql.matchAll(/insert into private\.post_category_contracts values\r?\n[\s\S]*?;/g),
    ];
    assert.equal(matches.length, 1);
    assert.equal((matches[0][0].match(/'fixture_/g) ?? []).length, 4);
    sql = sql.replace(
      matches[0][0],
      "-- Test-only category bootstrap omitted; canonical reference seed follows."
    );
  }
  if (file.endsWith("/listing-attributes.sql")) {
    const compatibilityMatches = [
      ...sql.matchAll(
        /    if not p_complete and p_category='fixture_market' and p_attributes='\{\}'::jsonb then return p_attributes; end if;\r?\n/g
      ),
    ];
    assert.equal(compatibilityMatches.length, 1);
    const compatibility = compatibilityMatches[0][0];
    const original = [
      ...sql.matchAll(
        /create function internal\.validate_listing_attributes\([^;]+?as \$\$([\s\S]*?)\$\$;/g
      ),
    ];
    assert.equal(original.length, 1);
    assert.equal(
      digest(original[0][1]),
      evidence.appliedFunctions.find((fn) => fn.name === "internal.validate_listing_attributes")
        .bodyHash
    );
    sql = sql.replace(compatibility, "");
    modifiedBodies.set(
      "internal.validate_listing_attributes",
      "Remove test-only fixture_market bypass; requires separate baseline replay and strict-category proof"
    );
  }
  if (file.endsWith("/entitlements.sql")) {
    const keys = [
      ...sql.matchAll(
        /^  \('([a-z0-9_]+)', (\d+), (?:null|'(?:market|business|tourism_events)')/gm
      ),
    ]
      .map((match) => `${match[1]}@${match[2]}`)
      .sort();
    assert.deepEqual(keys, Object.keys(identities.plans).sort());
    const planStart = "insert into private.plan_versions (plan_code,";
    const planSelect = "select seed.*,array['boost','featured','urgent']::text[]";
    assert.equal(sql.split(planStart).length, 2);
    assert.equal(sql.split(planSelect).length, 2);
    sql = sql
      .replace(planStart, "insert into private.plan_versions (id, plan_code,")
      .replace(
        planSelect,
        () =>
          `select ${identityCase("plans", "plan_code")},seed.*,array['boost','featured','urgent']::text[]`
      );
    const addonSeed =
      /insert into private\.addon_versions \(kind, version, days, price_cents\)\r?\nvalues ([^;]+);/g;
    const matches = [...sql.matchAll(addonSeed)];
    assert.equal(matches.length, 1);
    const addonKeys = [...matches[0][1].matchAll(/\('([a-z_]+)', (\d+),/g)]
      .map((match) => `${match[1]}@${match[2]}`)
      .sort();
    assert.deepEqual(addonKeys, Object.keys(identities.addons).sort());
    sql = sql.replace(
      addonSeed,
      () =>
        `insert into private.addon_versions (id, kind, version, days, price_cents)\nselect ${identityCase("addons", "kind")},seed.* from (values ${matches[0][1]}) as seed(kind,version,days,price_cents);`
    );
  }
  modules.push(`-- Source: ${file}\n${sql.trim()}\n`);
}
const candidate = `-- UNRELEASED BF-09 assembly; not an approved target migration.\n-- Source migrations remain unchanged. See README.md and assembly.json.\n\n${modules.join("\n")}\n`;
assert.equal(
  /transport_resources|transport_jobs|rename_transport_resource|enqueue_transport_reconciliation|'fixture_/.test(
    candidate
  ),
  false
);
const bodies = new Map(
  [
    ...candidate.matchAll(
      /create (?:or replace )?function ([\w.]+)\([^;]+?as \$\$([\s\S]*?)\$\$;/g
    ),
  ].map((m) => [m[1], digest(m[2])])
);
const excluded = [
  "internal.rename_transport_resource",
  "api.rename_transport_resource",
  "internal.enqueue_transport_reconciliation",
  "api.enqueue_transport_reconciliation",
  "api.grant_intro_trial",
  "api.record_identity_ban",
];
const accepted = evidence.appliedFunctions.filter((fn) => !excluded.includes(fn.name));
assert.equal(accepted.length, evidence.appliedFunctions.length - excluded.length);
assert.equal(bodies.size, accepted.length);
for (const fn of accepted) {
  if (modifiedBodies.has(fn.name)) assert.notEqual(bodies.get(fn.name), fn.bodyHash);
  else
    assert.equal(bodies.get(fn.name), fn.bodyHash, `Function differs from native body: ${fn.name}`);
}
assert.equal(
  /create\s+(?:or\s+replace\s+)?function\s+api\.(?:grant_intro_trial|record_identity_ban)\s*\(/i.test(
    candidate
  ),
  false
);
for (const name of ["candidate.sql", "assembly.json"])
  assertFixturePath(root, `${workspace}/${name}`, { type: "file", allowMissing: true });
writeFileSync(`${workspace}/candidate.sql`, candidate);
writeFileSync(
  `${workspace}/assembly.json`,
  JSON.stringify(
    {
      schemaVersion: 1,
      status: "DRAFT assembly only; not replayed or deployable",
      releaseReady: false,
      sourceEvidence: evidencePath,
      evidenceHash: digest(readFileSync(evidencePath)),
      sourceHashes,
      candidateHash: digest(candidate),
      catalogueSeedIdentities: identities,
      catalogueSeedIdentitiesHash: digest(readFileSync(identitiesPath)),
      functions: accepted.length,
      matchingNativeFunctionBodies: accepted.length - modifiedBodies.size,
      derivedFunctionChanges: Object.fromEntries(modifiedBodies),
      removedTestFunctions: excluded,
      removedTestTables: ["private.transport_resources", "private.transport_jobs"],
      removedTestSeedRows: 4,
      cliGeneratedMigration: `supabase/migrations/${migrations[0]}`,
      deploymentGuardHash: digest(gate),
      baselineReplay: "INCOMPLETE; requires a separate empty native Auth/PostgREST workspace",
      requiredGates: [
        "Remaining G1 field/verification/retention contracts and independent review",
        "BF-09 native empty replay and full reference/config/seed review",
        "Independent fixed catalogue identity and full reference/config seed acceptance",
        "BF-10 adapters/types/API manifest",
        "BF-11/12/28 authority and hosted configuration",
        "Performance, recovery, provider and rollout acceptance",
      ],
      targetProject: null,
      productionMutations: [],
    },
    null,
    2
  ) + "\n"
);
process.stdout.write(
  JSON.stringify({
    status: "DRAFT",
    functions: accepted.length,
    candidateHash: digest(candidate),
    deploymentBlocked: true,
  }) + "\n"
);

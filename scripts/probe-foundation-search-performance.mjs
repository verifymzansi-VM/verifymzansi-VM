import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";
import { nativeIsolation, nativeDigest } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
assert.equal(process.argv.length, 2);
const { env, dockerArgs, workdir } = nativeIsolation();
const release = acquireFixtureOperation(workdir, "test");
const args = [
  ...dockerArgs,
  "exec",
  "-i",
  "supabase_db_backend-foundation-impl",
  "psql",
  "-XqAt",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
];
const sql = (q) =>
  execFileSync("docker", args, {
    env,
    input: q,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const result = {
  recordedAt: new Date().toISOString(),
  status: "INCOMPLETE",
  scope: "Local rollback-only synthetic plan diagnostic, not hosted performance acceptance",
  productionMutations: [],
};
let stage = "empty fixture preflight",
  emptyFixtureVerified = false;
result.provenance = Object.fromEntries(
  [
    "scripts/probe-foundation-search-performance.mjs",
    "scripts/test-foundation-native.mjs",
    "scripts/lib/foundation-native-isolation.mjs",
    "scripts/lib/foundation-native-lock.mjs",
    "scripts/lib/foundation-native-paths.mjs",
  ].map((file) => [file, nativeDigest(file)])
);
try {
  assert.equal(sql("select count(*) from auth.users;"), "0");
  assert.equal(sql("select count(*) from private.posts;"), "0");
  emptyFixtureVerified = true;
  stage = "fixed seed extraction";
  const owner = randomUUID(),
    funder = randomUUID();
  const source = readFileSync("scripts/test-foundation-native.mjs", "utf8").replaceAll(
    "\r\n",
    "\n"
  );
  const start = source.indexOf(
    "sql(`begin;\ninsert into private.posts(id,owner_id,kind,area,category_key,status,published_at,visible_until)"
  );
  assert.ok(start > 0);
  let seed = source.slice(start + 5, source.indexOf("commit;`);", start));
  const replacements = {
    "searchOwner.id": owner,
    "other.id": funder,
    SEARCH_ROWS: "10050",
    "Math.floor(SEARCH_ROWS / 1000)": "10",
    "choice.key": "device_type",
    choiceValue: "Smartphone",
    "range.key": "storage_gb",
  };
  seed = seed
    .replace(/\$\{([^}]+)\}/g, (_, k) => {
      assert.ok(Object.hasOwn(replacements, k));
      return replacements[k];
    })
    .replace(/^begin;\s*/, "");
  const query =
    "select d.post_id from private.post_search_documents d where d.is_visible and exists(select 1 from private.public_eligible_posts eligible where eligible.id=d.post_id) and d.published_at<=statement_timestamp() and (d.visible_until is null or d.visible_until>statement_timestamp()) and d.kind='listing' and d.facets->>'condition'='good'";
  const probe = (label) =>
    `do $probe$ declare p jsonb; t timestamptz; response jsonb; begin execute 'explain(analyze,buffers,format json) ${query.replaceAll("'", "''")}' into p; t:=clock_timestamp(); response:=internal.search_posts('{"condition":"good","limit":1}'::jsonb); raise notice 'BF_SEARCH_DIAGNOSTIC %',jsonb_build_object('stage','${label}','plan',p,'internalFunctionMs',extract(epoch from clock_timestamp()-t)*1000,'total',response->'total'); end $probe$;`;
  stage = "rollback-only execution";
  const run = spawnSync("docker", args, {
    env,
    input: `begin; set local statement_timeout='30s'; insert into auth.users(id,is_anonymous) values('${owner}',false),('${funder}',false); ${seed} ${probe("before_stats")} analyze private.posts,private.post_search_documents,private.entitlements,private.post_activations; ${probe("after_stats")} rollback;`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 90000,
    maxBuffer: 5e6,
  });
  result.exitCode = run.status;
  result.diagnostics = String(run.stderr ?? "")
    .split("\n")
    .filter((l) => l.includes("BF_SEARCH_DIAGNOSTIC "))
    .map((l) => JSON.parse(l.split("BF_SEARCH_DIAGNOSTIC ")[1]));
  assert.equal(run.status, 0);
  assert.deepEqual(
    result.diagnostics.map((item) => [item.stage, item.total]),
    [
      ["before_stats", 3],
      ["after_stats", 3],
    ]
  );
  result.status = "PASS diagnostic captured";
  result.timeout = /statement timeout/.test(String(run.stderr ?? ""));
} catch {
  result.status = "FAIL";
  result.stage = stage;
} finally {
  try {
    result.cleanup = JSON.parse(
      sql(
        "select json_build_object('authUsers',(select count(*) from auth.users),'posts',(select count(*) from private.posts),'searchRows',(select count(*) from private.post_search_documents));"
      )
    );
    if (emptyFixtureVerified) {
      assert.deepEqual(result.cleanup, { authUsers: 0, posts: 0, searchRows: 0 });
      sql(
        "analyze private.posts,private.post_search_documents,private.entitlements,private.post_activations;"
      );
    }
  } catch {
    result.status = "INCOMPLETE";
    result.cleanup = "INCOMPLETE rollback/statistics reconciliation";
  } finally {
    try {
      release();
      result.lockReleased = true;
    } catch {
      result.status = "INCOMPLETE";
      result.lockReleased = false;
    }
  }
  const file = `docs/backend-foundation/evidence/search-performance-diagnostic-${result.recordedAt.replaceAll(":", "-")}.json`;
  assertFixturePath(process.cwd(), file, { allowMissing: true, type: "file" });
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({
      status: result.status,
      evidence: file,
      diagnostics: result.diagnostics?.map((x) => ({
        stage: x.stage,
        internalFunctionMs: x.internalFunctionMs,
        total: x.total,
        planMs: x.plan[0]["Execution Time"],
      })),
      timeout: result.timeout,
      cleanup: result.cleanup,
    })
  );
  if (!result.status.startsWith("PASS")) process.exitCode = 1;
}

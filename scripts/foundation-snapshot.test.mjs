import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { replayFoundation } from "./lib/foundation-replay.mjs";
import {
  SNAPSHOT_DIR,
  pgliteJson,
  readSnapshotCatalogue,
  renderSnapshot,
  snapshotDifferences,
  writeSnapshot,
} from "./lib/foundation-snapshot.mjs";

const EDITED_GUARD =
  "create or replace function internal.acceptance_signup_guard(p_event jsonb) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$ select '{}'::jsonb $$;";

async function renderReplay(extraSql = []) {
  const replay = await replayFoundation({ extraSql });
  try {
    return renderSnapshot(await readSnapshotCatalogue(pgliteJson(replay.db)));
  } finally {
    await replay.db.close();
  }
}

test(
  "the committed current/ snapshot matches the replay and a changed function is detected",
  { timeout: 180000 },
  async () => {
    const files = await renderReplay();
    assert.deepEqual(snapshotDifferences(files), [], `run pnpm db:foundation:snapshot`);
    for (const [relative, content] of files) {
      assert.ok(!content.includes("\r"), `${relative} must use LF line endings`);
      assert.ok(content.endsWith("\n"), `${relative} must end with a newline`);
    }
    const keys = [...files.keys()];
    assert.deepEqual(keys.slice(0, -1), [...keys.slice(0, -1)].sort());
    assert.ok(files.has("functions/internal/staff_actor.sql"));
    assert.ok(files.has("tables/private/posts.sql"));

    // Same schema plus one edited function body, without regenerating.
    const edited = await renderReplay([EDITED_GUARD]);
    const root = mkdtempSync(path.join(tmpdir(), "foundation-snapshot-"));
    try {
      writeSnapshot(files, root);
      assert.deepEqual(snapshotDifferences(edited, root), [
        "changed: functions/internal/acceptance_signup_guard.sql",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

const fn = (schema, name, signature, body, grants = []) => ({
  schema,
  name,
  kind: "f",
  signature,
  definition: `CREATE OR REPLACE FUNCTION ${signature}\r\n RETURNS integer\n LANGUAGE sql\nAS $function$ ${body} $function$\n`,
  owner: "postgres",
  grants,
  comment: null,
});
const emptyCatalogue = {
  schemas: [],
  extensions: [],
  defaultPrivileges: [],
  eventTriggers: [],
  functions: [],
  relations: [],
  sequences: [],
  platformHooks: [],
};

test("overloads share a file; grants are grouped; output uses LF only", () => {
  const files = renderSnapshot({
    ...emptyCatalogue,
    functions: [
      fn("api", "pick", "api.pick(integer)", "select 1", [
        { grantee: "anon", privilege: "execute", grantable: false },
        { grantee: "authenticated", privilege: "execute", grantable: false },
      ]),
      fn("api", "pick", "api.pick(text)", "select 2"),
    ],
  });
  const content = files.get("functions/api/pick.sql");
  assert.ok(content.includes("api.pick(integer)") && content.includes("api.pick(text)"));
  assert.ok(content.includes("grant execute on function api.pick(integer) to anon;"));
  assert.ok(content.includes("revoke all on function api.pick(text) from public;"));
  assert.ok(!content.includes("\r"));
  assert.deepEqual(
    [...files.keys()],
    ["functions/api/pick.sql", "platform-hooks.sql", "schemas.sql", "sequences.sql", "README.md"]
  );
});

test("unsafe or clashing names are refused instead of writing odd paths", () => {
  assert.throws(
    () =>
      renderSnapshot({ ...emptyCatalogue, functions: [fn("api", "../x", "api.x()", "select 1")] }),
    /Unsupported function name/
  );
  const table = (name) => ({
    schema: "private",
    name,
    kind: "r",
    ident: `private.${name}`,
    owner: "postgres",
    options: null,
    rls: true,
    forceRls: false,
    view: null,
    comment: null,
    grants: [],
    columns: [],
    constraints: [],
    indexes: [],
    triggers: [],
    policies: [],
  });
  assert.throws(
    () => renderSnapshot({ ...emptyCatalogue, relations: [table("Posts"), table("posts")] }),
    /Unsupported relation name|clash/
  );
});

test("new, removed and edited snapshot files are all reported", () => {
  const root = mkdtempSync(path.join(tmpdir(), "foundation-snapshot-"));
  try {
    const files = new Map([
      ["a.sql", "-- a\n"],
      ["b.sql", "-- b\n"],
    ]);
    writeSnapshot(files, root);
    writeFileSync(path.join(root, SNAPSHOT_DIR, "stale.sql"), "-- old\n");
    const next = new Map([
      ["a.sql", "-- a changed\n"],
      ["c.sql", "-- c\n"],
      ["b.sql", "-- b\n"],
    ]);
    assert.deepEqual(snapshotDifferences(next, root), [
      "changed: a.sql",
      "missing: c.sql",
      "extra: stale.sql",
    ]);
    writeSnapshot(next, root);
    assert.deepEqual(snapshotDifferences(next, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

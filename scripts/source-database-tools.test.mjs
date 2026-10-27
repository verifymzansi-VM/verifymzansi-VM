import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSourceDatabaseTool, isSourceSchemaOperation } from "./lib/source-database-tools.mjs";

test("source tools refuse foundation mode, configured project and explicit target", () => {
  for (const env of [
    { NEXT_PUBLIC_DATA_BACKEND: "foundation" },
    {
      NEXT_PUBLIC_DATA_BACKEND: "source",
      NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
    },
    { SUPABASE_PROJECT_REF: "gntzjtuncsyefujajmjy" },
  ])
    assert.throws(() => assertSourceDatabaseTool("Fixture", env), /retired source schema/);
  assert.throws(
    () => assertSourceDatabaseTool("Fixture", {}, ["gntzjtuncsyefujajmjy"]),
    /retired source schema/
  );
  assert.doesNotThrow(() =>
    assertSourceDatabaseTool("Fixture", {
      NEXT_PUBLIC_DATA_BACKEND: "source",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    })
  );
});

test("only help and known inspection commands bypass the root schema guard", () => {
  for (const args of [
    ["db", "push"],
    ["db", "reset", "--local"],
    ["db", "query"],
    ["db", "pull"],
    ["migration", "up"],
    ["migration", "repair"],
    ["migration", "new", "wrong_schema"],
    ["db", "future-command"],
  ])
    assert.equal(isSourceSchemaOperation(args), true, args.join(" "));
  for (const args of [
    ["db", "push", "--help"],
    ["db", "dump"],
    ["db", "advisors"],
    ["migration", "list"],
    ["--version"],
  ])
    assert.equal(isSourceSchemaOperation(args), false, args.join(" "));
});

test("actual wrapper rejects root push before credentials or network access", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-supabase-cli.ts", "db", "push"],
    {
      env: {
        ...process.env,
        NEXT_PUBLIC_DATA_BACKEND: "foundation",
        SUPABASE_ACCESS_TOKEN: "",
        SUPABASE_DB_PASSWORD: "",
      },
      encoding: "utf8",
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /retired source schema/);
  assert.doesNotMatch(result.stderr, /Missing required environment variables/);
});

test("legacy bootstrap, export and reset stop before accessing the new project", () => {
  for (const script of ["bootstrap-operator.ts", "backup-supabase.ts", "reset-launch-data.ts"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}`], {
      env: { ...process.env, NEXT_PUBLIC_DATA_BACKEND: "foundation" },
      encoding: "utf8",
    });
    assert.equal(result.status, 1, script);
    assert.match(result.stderr, /retired source schema/, script);
  }
});

test("actual wrapper passes shell metacharacters as one literal argument", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-supabase-cli.ts", "--version", "&echo SHELL_MUST_NOT_RUN"],
    {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: "", SUPABASE_DB_PASSWORD: "" },
      encoding: "utf8",
    }
  );
  assert.doesNotMatch(result.stdout, /^SHELL_MUST_NOT_RUN\s*$/m);
  assert.doesNotMatch(result.stderr, /Missing required environment variables/);
});

test("explicit env files parse quotes, embedded equals and comments without shell evaluation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vm-env-fixture-"));
  const filename = path.join(dir, "fixture.env");
  try {
    await writeFile(filename, 'VM_ENV_FIXTURE="a=b # literal" # comment\n');
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'import env from "./scripts/lib/workspace-env.ts"; await env.loadWorkspaceEnv(process.argv[1]); if(process.env.VM_ENV_FIXTURE !== "a=b # literal") throw new Error("Incorrect env parsing");',
        filename,
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await unlink(filename);
    await rmdir(dir);
  }
});

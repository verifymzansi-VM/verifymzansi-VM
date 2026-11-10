import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  API_MANIFESTS,
  CONTRACT_STEPS,
  FINGERPRINT,
  UPDATES_README,
  checkContractSteps,
  checkUpdateRegister,
  codeReferences,
  diffApiContracts,
  introducingUpdates,
  LEGACY_STATUS_THROUGH,
  listUpdateFiles,
  parseContractSteps,
  parseUpdateRegister,
  readFoundationUpdateDrift,
  readJsonFile,
  removedUpdateFiles,
  updateDrift,
} from "./lib/foundation-update-order.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
const readme = readFileSync(path.join(repo, UPDATES_README), "utf8");
const fingerprint = readJsonFile(repo, FINGERPRINT);
const files = listUpdateFiles(repo);
const [baseline, runtime] = API_MANIFESTS.map((file) => readJsonFile(repo, file));

const fn = (name, args = [], extra = {}) => ({
  name,
  arguments: args.map(([argName, sqlType, optional = false]) => ({
    name: argName,
    sqlType,
    optional,
  })),
  returns: "jsonb",
  execute: { anon: false, authenticated: true, service_role: false },
  ...extra,
});
const manifests = (...functions) => [{ functions }];
const register = (lines) =>
  `<!-- applied-register:start -->\n${lines.join("\n")}\n<!-- applied-register:end -->\n`;

test("the committed register lists every update, applied with a time or pending as fingerprint.json says", () => {
  const { rows, errors } = parseUpdateRegister(readme);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    rows.map((row) => row.file),
    files
  );
  assert.deepEqual(checkUpdateRegister({ files, rows, fingerprint }), []);
  const pending = fingerprint.productionCheck.pendingApplication;
  assert.ok(
    rows.every((row) =>
      row.kind === "applied"
        ? Boolean(row.date && row.evidence) && !pending.includes(row.file)
        : row.kind === "pending" && pending.includes(row.file)
    )
  );
  assert.deepEqual(parseContractSteps(readJsonFile(repo, CONTRACT_STEPS)).errors, []);
});

test("register problems are reported: missing, unknown, out of order, pending mismatch, bad dates", () => {
  const a = "20261101000000_a.sql";
  const b = "20261102000000_b.sql";
  const fp = (pending = [], through = a) => ({
    productionCheck: { matchedThroughUpdate: through, pendingApplication: pending },
  });
  const ok = parseUpdateRegister(
    register([`- \`${a}\`: applied 2026-11-01 10:00 UTC; recorded`, `- \`${b}\`: pending`])
  );
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(checkUpdateRegister({ files: [a, b], rows: ok.rows, fingerprint: fp([b]) }), []);

  // A wrapped line (prettier) still parses.
  const wrapped = parseUpdateRegister(
    register([`- \`${a}\`: applied before 2026-11-02 05:06 UTC (exact time not`, "  recorded); x"])
  );
  assert.deepEqual(wrapped.errors, []);
  assert.equal(wrapped.rows[0].date, "2026-11-02");

  const problems = (lines, fileList, print) =>
    checkUpdateRegister({
      files: fileList,
      rows: parseUpdateRegister(register(lines)).rows,
      fingerprint: print,
    }).join("\n");
  assert.match(
    problems([`- \`${a}\`: applied 2026-11-01 10:00 UTC; r`], [a, b], fp()),
    /b\.sql: missing from the applied register/
  );
  assert.match(
    problems([`- \`${a}\`: applied 2026-11-01 10:00 UTC; r`, `- \`${b}\`: pending`], [a, b], fp()),
    /pending in the register but not in fingerprint/
  );
  assert.match(
    problems([`- \`${a}\`: applied 2026-11-01 10:00 UTC; r`], [a], fp([a])),
    /applied in the register but listed in pendingApplication/
  );
  assert.match(
    problems(
      [`- \`${b}\`: pending`, `- \`${a}\`: applied 2026-11-01 10:00 UTC; r`],
      [a, b],
      fp([b])
    ),
    /not in filename order/
  );
  assert.match(
    problems([`- \`${a}\`: applied 2026-10-31 10:00 UTC; r`], [a], fp()),
    /before the file's own timestamp/
  );
  assert.match(problems([`- \`${a}\`: applied 2026-11-01 10:00 UTC`], [a], fp()), /needs evidence/);
  assert.match(
    problems([`- \`${a}\`: pending`], [a], fp([a], a)),
    /pending, but production matched through/
  );
  assert.match(
    problems(
      [`- \`${a}\`: applied 2026-11-01 10:00 UTC; r`, "- `20261103000000_c.sql`: pending"],
      [a],
      fp(["20261103000000_c.sql"])
    ),
    /in the register but not in updates/
  );
  assert.match(
    parseUpdateRegister(register([`- \`${a}\`: done yesterday; r`])).errors.join(),
    /unknown status/
  );
  assert.match(parseUpdateRegister("no markers").errors.join(), /no applied register markers/);
});

test("removed and renamed commands and arguments, type, required, return and grant changes are found", () => {
  const before = manifests(
    fn("get_thing", [
      ["p_id", "uuid"],
      ["p_page", "integer", true],
    ]),
    fn("old_name", [["p_x", "text"]]),
    fn("dropped"),
    fn("narrowed", [], { execute: { anon: false, authenticated: true, service_role: true } })
  );
  const after = manifests(
    fn(
      "get_thing",
      [
        ["p_key", "uuid"],
        ["p_page", "text"],
        ["p_new", "boolean"],
      ],
      { returns: "boolean" }
    ),
    fn("new_name", [["p_x", "text"]]),
    fn("narrowed", [], { execute: { anon: false, authenticated: true, service_role: false } }),
    fn("added_command", [["p_any", "text"]])
  );
  const findings = diffApiContracts(before, after);
  assert.deepEqual(
    findings.map((f) => [f.command, f.change, f.argument ?? f.role ?? ""]),
    [
      ["get_thing", "remove-argument", "p_id"],
      ["get_thing", "argument-type", "p_page"],
      ["get_thing", "require-argument", "p_page"],
      ["get_thing", "require-argument", "p_key"],
      ["get_thing", "require-argument", "p_new"],
      ["get_thing", "returns", ""],
      ["old_name", "remove", ""],
      ["dropped", "remove", ""],
      ["narrowed", "revoke", "service_role"],
    ]
  );
  assert.match(findings[0].detail, /p_key with the same type was added \(a rename\)/);
  assert.match(findings[6].detail, /new_name with the same arguments was added .*\(a rename\)/);
  assert.deepEqual(diffApiContracts([baseline, runtime], [baseline, runtime]), []);
  assert.deepEqual(
    diffApiContracts(manifests(fn("a")), manifests(fn("a"), fn("b", [["p_y", "text"]]))),
    []
  );
});

const appliedRows = [
  { file: "20261101000000_expand.sql", kind: "applied" },
  { file: "20261102000000_pending.sql", kind: "pending" },
];
const step = (extra) => ({
  command: "old_name",
  change: "remove",
  expandUpdate: "20261101000000_expand.sql",
  expandPullRequest: 140,
  reason: "Callers moved to new_name in the expand pull request.",
  ...extra,
});
const contract = (baseManifests, headManifests, steps, extra = {}) =>
  checkContractSteps({
    findings: diffApiContracts(baseManifests, headManifests),
    steps,
    baseSteps: [],
    baseUpdateFiles: ["20261101000000_expand.sql"],
    headUpdateFiles: ["20261101000000_expand.sql", "20261102000000_pending.sql"],
    baseRows: appliedRows,
    baseManifests,
    headManifests,
    ...extra,
  }).join("\n");

test("a breaking change needs a recorded second step of an earlier, applied expand update", () => {
  const expanded = manifests(fn("old_name", [["p_x", "text"]]), fn("new_name", [["p_x", "text"]]));
  const contracted = manifests(fn("new_name", [["p_x", "text"]]));
  assert.match(
    contract(expanded, contracted, []),
    /old_name removed.*without a recorded second step/
  );
  assert.equal(contract(expanded, contracted, [step({ replacement: "new_name" })]), "");
  assert.equal(contract(expanded, contracted, [step()]), "");

  // Renamed in one step: the replacement did not exist on the base commit.
  const oneStep = contract(manifests(fn("old_name", [["p_x", "text"]])), contracted, [
    step({ replacement: "new_name" }),
  ]);
  assert.match(oneStep, /replacement new_name must already exist on the base commit/);
  // The expand update must already be merged and applied.
  assert.match(
    contract(expanded, contracted, [step({ expandUpdate: "20261103000000_same_pr.sql" })]),
    /not on the base commit.*\n.*not recorded as applied/
  );
  assert.match(
    contract(expanded, contracted, [step({ expandUpdate: "20261102000000_pending.sql" })], {
      baseUpdateFiles: ["20261102000000_pending.sql"],
    }),
    /not recorded as applied/
  );
  // The code must have switched before the command is removed.
  assert.match(
    contract(expanded, contracted, [step()], {
      references: () => ["src/lib/foundation/x.ts"],
    }),
    /still names it in src\/lib\/foundation\/x\.ts/
  );
  // Argument rename: second step with an existing replacement argument.
  const argBase = manifests(
    fn("cmd", [
      ["p_old", "uuid", true],
      ["p_new", "uuid", true],
    ])
  );
  const argHead = manifests(fn("cmd", [["p_new", "uuid", true]]));
  assert.match(contract(argBase, argHead, []), /argument p_old removed/);
  assert.equal(
    contract(argBase, argHead, [
      step({ command: "cmd", change: "remove-argument", argument: "p_old", replacement: "p_new" }),
    ]),
    ""
  );
  assert.match(
    contract(manifests(fn("cmd", [["p_old", "uuid"]])), argHead, [
      step({ command: "cmd", change: "remove-argument", argument: "p_old", replacement: "p_new" }),
    ]),
    /replacement argument p_new must already exist/
  );
});

test("contract-steps.json entries are validated", () => {
  assert.match(parseContractSteps({}).errors.join(), /schemaVersion 1/);
  const errors = parseContractSteps({
    schemaVersion: 1,
    steps: [
      {
        command: "Bad-Name",
        change: "drop",
        expandUpdate: "x.sql",
        expandPullRequest: 0,
        reason: "",
      },
      step({ change: "remove-argument" }),
      step({ change: "revoke" }),
      step({ change: "returns", replacement: "x" }),
      step(),
      step(),
    ],
  }).errors.join("\n");
  for (const pattern of [
    /command must be an API function name/,
    /change must be one of/,
    /expandUpdate must name/,
    /expandPullRequest must be/,
    /reason must explain/,
    /argument is required exactly/,
    /role .* is required exactly for revoke/,
    /replacement is only for/,
    /duplicate step/,
  ])
    assert.match(errors, pattern);
});

test("drift: behind, ahead, applied-but-unrecorded and unobservable updates", () => {
  const manifest = {
    functions: [
      { name: "f_a", updates: ["updates/20261101000000_a.sql"] },
      { name: "f_b", updates: ["updates/20261102000000_b.sql", "updates/20261103000000_c.sql"] },
    ],
  };
  const list = ["20261101000000_a.sql", "20261102000000_b.sql", "20261103000000_c.sql"];
  assert.deepEqual(
    introducingUpdates(manifest),
    new Map([
      ["20261101000000_a.sql", ["f_a"]],
      ["20261102000000_b.sql", ["f_b"]],
    ])
  );
  const rows = (pending = []) =>
    list.map((file) => ({ file, kind: pending.includes(file) ? "pending" : "applied" }));
  const present = [
    { name: "f_a", state: "present" },
    { name: "f_b", state: "present" },
  ];
  const inStep = updateDrift({
    files: list,
    rows: rows(),
    runtimeManifest: manifest,
    probes: present,
  });
  assert.deepEqual([inStep.behind, inStep.ahead, inStep.unrecorded], [[], [], []]);
  assert.deepEqual(inStep.unobservable, ["20261103000000_c.sql"]);

  // A command is missing live: its update is behind even if recorded applied.
  const missing = updateDrift({
    files: list,
    rows: rows(),
    runtimeManifest: manifest,
    probes: [present[0], { name: "f_b", state: "missing" }],
  });
  assert.deepEqual(missing.behind, ["20261102000000_b.sql"]);
  // A pending body-only update is behind on the record alone.
  const pendingOnly = updateDrift({
    files: list,
    rows: rows(["20261103000000_c.sql"]),
    runtimeManifest: manifest,
    probes: present,
  });
  assert.deepEqual(pendingOnly.behind, ["20261103000000_c.sql"]);
  // Applied but the register still says pending.
  const unrecorded = updateDrift({
    files: list,
    rows: rows(["20261102000000_b.sql"]),
    runtimeManifest: manifest,
    probes: present,
  });
  assert.deepEqual([unrecorded.behind, unrecorded.unrecorded], [[], ["20261102000000_b.sql"]]);
  // An update reverted out of the repository after merge: the database is ahead.
  const ahead = updateDrift({
    files: list,
    rows: rows(),
    runtimeManifest: manifest,
    probes: present,
    removedFiles: ["20261104000000_reverted.sql"],
  });
  assert.deepEqual(ahead.ahead, ["20261104000000_reverted.sql"]);
  // Staging has no register: only live evidence counts.
  const staging = updateDrift({ files: list, runtimeManifest: manifest, probes: present });
  assert.deepEqual(staging.behind, []);
});

test("the live comparison sends only the publishable key and reports a missing command as behind", async () => {
  const connection = {
    url: "https://gntzjtuncsyefujajmjy.supabase.co",
    publishableKey: "sb_publishable_synthetic",
  };
  const target = runtime.functions.find((item) => !item.execute.anon);
  const introducing = [...target.updates].sort()[0].replace("updates/", "");
  const requests = [];
  const { drift, lines } = await readFoundationUpdateDrift(connection, {
    root: repo,
    removedFiles: [],
    fetcher: async (url, init) => {
      requests.push(init);
      const name = url.split("/rpc/")[1];
      const fnSpec = runtime.functions.find((item) => item.name === name);
      if (name === target.name) return Response.json({ code: "PGRST202" }, { status: 404 });
      if (fnSpec.execute.anon) return Response.json([]);
      return Response.json({ code: "42501" }, { status: 401 });
    },
  });
  assert.equal(requests.length, runtime.functions.length);
  for (const init of requests) {
    assert.equal(init.headers.apikey, "sb_publishable_synthetic");
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.credentials, "omit");
  }
  assert.deepEqual(drift.behind, [introducing]);
  assert.match(lines[0].text, new RegExp(`production database behind by 1: ${introducing}`));
});

// Throwaway local probe: a temporary git repository with the real manifests,
// a base commit and a head commit, checked by the real CLI.
const cli = path.join(repo, "scripts/check-foundation-update-order.mjs");
function probeRepository(mutate, steps = [], options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vm-update-order-"));
  try {
    const git = (...args) =>
      execFileSync(
        "git",
        ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args],
        {
          cwd: dir,
          encoding: "utf8",
          windowsHide: true,
        }
      );
    mkdirSync(path.join(dir, "database/foundation/updates"), { recursive: true });
    for (const file of [...API_MANIFESTS, FINGERPRINT, UPDATES_README])
      copyFileSync(path.join(repo, file), path.join(dir, file));
    for (const file of files)
      writeFileSync(path.join(dir, "database/foundation/updates", file), "");
    const write = (file, value) => writeFileSync(path.join(dir, file), JSON.stringify(value));
    write(CONTRACT_STEPS, { schemaVersion: 1, steps: options.baseSteps ?? [] });
    options.base?.(dir);
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").trim();
    const [b, r] = API_MANIFESTS.map((file) =>
      JSON.parse(readFileSync(path.join(dir, file), "utf8"))
    );
    mutate(b, r);
    write(API_MANIFESTS[0], b);
    write(API_MANIFESTS[1], r);
    write(CONTRACT_STEPS, { schemaVersion: 1, steps: [...(options.baseSteps ?? []), ...steps] });
    options.head?.(dir);
    git("add", "-A");
    git("commit", "-q", "-m", "head");
    return spawnSync(process.execPath, [cli, "--base", base], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, GITHUB_ACTIONS: "" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const victim = clone(
  runtime.functions.find((item) => item.arguments.length > 0 && !item.execute.anon)
);
const victimUpdate = [...victim.updates].sort()[0].replace("updates/", "");

test("probe: the CLI fails on a removed command, a removed field and a renamed command", () => {
  const removed = probeRepository((_b, r) => {
    r.functions = r.functions.filter((item) => item.name !== victim.name);
  });
  assert.equal(removed.status, 1, removed.stdout);
  assert.match(
    removed.stderr,
    new RegExp(`command ${victim.name} removed, without a recorded second step`)
  );

  const field = probeRepository((_b, r) => {
    r.functions.find((item) => item.name === victim.name).arguments.shift();
  });
  assert.equal(field.status, 1);
  assert.match(
    field.stderr,
    new RegExp(`${victim.name}: argument ${victim.arguments[0].name} removed`)
  );

  const renamed = probeRepository((_b, r) => {
    r.functions.find((item) => item.name === victim.name).name = `${victim.name}_v2`;
  });
  assert.equal(renamed.status, 1);
  assert.match(renamed.stderr, /\(a rename\), without a recorded second step/);

  // Even with a recorded step, a one-step rename fails: the replacement is new.
  const oneStep = probeRepository(
    (_b, r) => {
      r.functions.find((item) => item.name === victim.name).name = `${victim.name}_v2`;
    },
    [step({ command: victim.name, expandUpdate: victimUpdate, replacement: `${victim.name}_v2` })]
  );
  assert.equal(oneStep.status, 1);
  assert.match(oneStep.stderr, /must already exist on the base commit/);
});

test("probe: the CLI passes an addition, and a removal with a recorded second step", () => {
  const added = probeRepository((_b, r) => {
    r.functions.push({ ...clone(victim), name: "brand_new_command" });
  });
  assert.equal(added.status, 0, added.stderr);
  assert.match(
    added.stdout,
    /PASS database update order: \d+ updates in the register; 0 caller-breaking/
  );

  const contracted = probeRepository(
    (_b, r) => {
      r.functions = r.functions.filter((item) => item.name !== victim.name);
    },
    [step({ command: victim.name, expandUpdate: victimUpdate })]
  );
  assert.equal(contracted.status, 0, contracted.stderr);
  assert.match(contracted.stdout, /1 caller-breaking API change\(s\).*1 recorded second step/);
});

test("the staging check is inert until configured and never points at production", () => {
  const drift = path.join(repo, "scripts/check-foundation-update-drift.ts");
  const run = (env) =>
    spawnSync(process.execPath, ["--import", "tsx", drift, "--target=staging"], {
      cwd: repo,
      encoding: "utf8",
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        NODE_ENV: "test",
        GITHUB_ACTIONS: "",
        ...env,
      },
    });
  const inert = run({});
  assert.equal(inert.status, 0, inert.stderr);
  assert.match(inert.stdout, /Staging is not configured.*inert/);
  assert.match(
    run({ FOUNDATION_STAGING_SUPABASE_URL: "https://abcdefghijabcdefghij.supabase.co" }).stderr,
    /Incomplete staging connection settings/
  );
  const production = run({
    FOUNDATION_STAGING_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
    FOUNDATION_STAGING_PROJECT_REF: "gntzjtuncsyefujajmjy",
    FOUNDATION_STAGING_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
  });
  assert.equal(production.status, 1);
  assert.match(production.stderr, /must not point at the production project/);
});

test("the expand update must be applied on the base register, and a step authorises only its own change", () => {
  const expanded = manifests(fn("old_name", [["p_x", "text"]]), fn("new_name", [["p_x", "text"]]));
  const contracted = manifests(fn("new_name", [["p_x", "text"]]));
  // The pull request cannot flip its own expand update to applied: only the
  // base commit's register counts.
  assert.match(
    contract(expanded, contracted, [step()], {
      baseRows: [{ file: "20261101000000_expand.sql", kind: "pending" }],
    }),
    /not recorded as applied on the base commit; it must reach production, and be recorded so in an earlier pull request/
  );
  // An entry already on the base commit authorises nothing more.
  assert.match(
    contract(expanded, contracted, [step()], { baseSteps: [step()] }),
    /already on the base commit and authorises only the change it was added with/
  );
  // A new entry for the same kind of change, with its own expand update, does.
  assert.equal(
    contract(expanded, contracted, [step(), step({ expandUpdate: "20261103000000_second.sql" })], {
      baseSteps: [step()],
      baseUpdateFiles: ["20261101000000_expand.sql", "20261103000000_second.sql"],
      baseRows: [
        { file: "20261101000000_expand.sql", kind: "applied" },
        { file: "20261103000000_second.sql", kind: "applied" },
      ],
    }),
    ""
  );
  assert.deepEqual(
    parseContractSteps({
      schemaVersion: 1,
      steps: [step(), step({ expandUpdate: "20261103000000_second.sql" })],
    }).errors,
    []
  );
});

test("reverting an expand step production never received needs no entry", () => {
  const pending = "20261102000000_pending.sql";
  const introduced = manifests(fn("old_name", [], { updates: [`updates/${pending}`] }));
  const none = manifests();
  // Introducing update still pending on the base register.
  assert.equal(
    contract(introduced, none, [], {
      baseRows: [{ file: pending, kind: "pending" }],
      headUpdateFiles: [pending],
    }),
    ""
  );
  // Its update file is deleted in the same change.
  assert.equal(
    contract(introduced, none, [], {
      baseRows: [{ file: pending, kind: "applied" }],
      headUpdateFiles: [],
    }),
    ""
  );
  // Applied and still present: a real contract step is needed.
  assert.match(
    contract(introduced, none, [], {
      baseRows: [{ file: pending, kind: "applied" }],
      headUpdateFiles: [pending],
    }),
    /without a recorded second step/
  );
  // Reverting an optional argument added by a pending update.
  const old = "20261101000000_expand.sql";
  const before = manifests(
    fn(
      "cmd",
      [
        ["p_a", "text"],
        ["p_b", "text", true],
      ],
      {
        updates: [`updates/${old}`, `updates/${pending}`],
      }
    )
  );
  const after = manifests(fn("cmd", [["p_a", "text"]], { updates: [`updates/${old}`] }));
  assert.equal(
    contract(before, after, [], {
      baseRows: [
        { file: old, kind: "applied" },
        { file: pending, kind: "pending" },
      ],
    }),
    ""
  );
  assert.match(
    contract(before, after, [], {
      baseRows: [
        { file: old, kind: "applied" },
        { file: pending, kind: "applied" },
      ],
    }),
    /argument p_b removed, without a recorded second step/
  );
});

test("a git grep failure fails closed instead of meaning 'no references'", () => {
  const failing = (status, stderr) => () => {
    throw Object.assign(new Error("git"), { status, stderr });
  };
  assert.deepEqual(codeReferences("old_name", failing(1, "")), []);
  assert.throws(
    () => codeReferences("old_name", failing(128, "fatal: not a git repository")),
    /git grep failed/
  );
  assert.throws(() => codeReferences("old_name", failing(1, "fatal: bad")), /git grep failed/);
  assert.deepEqual(
    codeReferences("old_name", () => "src/a.ts\nworkers/b.ts\n"),
    ["src/a.ts", "workers/b.ts"]
  );
});

test("register dates must be real, and updates after the legacy ones record the UTC time", () => {
  const a = "20261101000000_a.sql";
  for (const status of [
    "applied 2026-99-99 99:99 UTC",
    "applied 2026-02-30 10:00 UTC",
    "applied 2026-11-01 24:00 UTC",
    "applied 2026-11-01 10:60 UTC",
    "applied 2026-13-01 (SAST date, time not recorded)",
    "applied before 2026-11-31 05:06 UTC (exact time not recorded)",
  ])
    assert.match(
      parseUpdateRegister(register([`- \`${a}\`: ${status}; r`])).errors.join(),
      /is not a real date and time/,
      status
    );
  const later = "20261111000000_later.sql";
  const fp = { productionCheck: { matchedThroughUpdate: later, pendingApplication: [] } };
  for (const status of [
    "applied 2026-11-11 (SAST date, time not recorded)",
    "applied before 2026-11-11 05:06 UTC (exact time not recorded)",
  ])
    assert.match(
      checkUpdateRegister({
        files: [later],
        rows: parseUpdateRegister(register([`- \`${later}\`: ${status}; r`])).rows,
        fingerprint: fp,
      }).join(),
      /record the application as "applied YYYY-MM-DD HH:MM UTC"/
    );
  assert.deepEqual(
    checkUpdateRegister({
      files: [later],
      rows: parseUpdateRegister(register([`- \`${later}\`: applied 2026-11-11 08:15 UTC; r`])).rows,
      fingerprint: fp,
    }),
    []
  );
  assert.ok(LEGACY_STATUS_THROUGH < later);
});

test("only update files deleted while recorded as applied count as ahead; renames and pending ones do not", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vm-update-removed-"));
  try {
    const git = (...args) =>
      execFileSync(
        "git",
        ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args],
        { cwd: dir, encoding: "utf8", windowsHide: true }
      );
    const updates = path.join(dir, "database/foundation/updates");
    mkdirSync(updates, { recursive: true });
    const applied = "20261101000000_applied.sql";
    const pendingFile = "20261102000000_pending.sql";
    const renamed = "20261103000000_renamed.sql";
    for (const [file, body] of [
      [applied, "select 1; -- applied\n"],
      [pendingFile, "select 2; -- pending\n"],
      [renamed, "select 3; -- a long enough body to be detected as a rename\n"],
    ])
      writeFileSync(path.join(updates, file), body);
    writeFileSync(
      path.join(dir, UPDATES_README),
      register([
        `- \`${applied}\`: applied 2026-11-01 10:00 UTC; r`,
        `- \`${pendingFile}\`: pending`,
        `- \`${renamed}\`: applied 2026-11-03 10:00 UTC; r`,
      ])
    );
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git(
      "mv",
      `database/foundation/updates/${renamed}`,
      "database/foundation/updates/20261103000000_better_name.sql"
    );
    git("commit", "-q", "-m", "rename");
    git("rm", "-q", `database/foundation/updates/${pendingFile}`);
    git("commit", "-q", "-m", "revert an unapplied update");
    assert.deepEqual(removedUpdateFiles(dir), []);
    git("rm", "-q", `database/foundation/updates/${applied}`);
    git("commit", "-q", "-m", "revert an applied update");
    assert.deepEqual(removedUpdateFiles(dir), [applied]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const markPending = (file) => (dir) => {
  const target = path.join(dir, UPDATES_README);
  const text = readFileSync(target, "utf8");
  const start = text.indexOf(`\`${file}\`: `) + file.length + 4;
  writeFileSync(target, `${text.slice(0, start)}pending${text.slice(text.indexOf(";", start))}`);
};
const restoreReadme = (dir) =>
  copyFileSync(path.join(repo, UPDATES_README), path.join(dir, UPDATES_README));
const removeVictim = (_b, r) => {
  r.functions = r.functions.filter((item) => item.name !== victim.name);
};

test("probe: a self-recorded expand update and a reused old entry fail; reverting a pending expand passes", () => {
  // The pull request marks its expand update (which introduced the replacement)
  // applied itself, while removing an older, applied command: refused.
  const expand = files.find((file) => file !== victimUpdate);
  const selfFlip = probeRepository(
    removeVictim,
    [step({ command: victim.name, expandUpdate: expand })],
    {
      base: markPending(expand),
      head: restoreReadme,
    }
  );
  assert.equal(selfFlip.status, 1, selfFlip.stdout);
  assert.match(selfFlip.stderr, /not recorded as applied on the base commit/);

  // An entry already on main does not authorise a new removal.
  const reused = probeRepository(removeVictim, [], {
    baseSteps: [step({ command: victim.name, expandUpdate: victimUpdate })],
  });
  assert.equal(reused.status, 1, reused.stdout);
  assert.match(reused.stderr, /already on the base commit/);

  // Reverting an expand step whose update main still lists as pending.
  const revert = probeRepository(removeVictim, [], {
    base: markPending(victimUpdate),
    head: restoreReadme,
  });
  assert.equal(revert.status, 0, revert.stderr);
});

test("staging comparison: unreachable or paused is inconclusive, a missing command fails", async () => {
  const { main } = await import("./check-foundation-update-drift.ts");
  const names = [
    "FOUNDATION_STAGING_SUPABASE_URL",
    "FOUNDATION_STAGING_PROJECT_REF",
    "FOUNDATION_STAGING_SUPABASE_PUBLISHABLE_KEY",
  ];
  const saved = names.map((name) => process.env[name]);
  const logged = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (line) => logged.push(String(line));
  console.error = (line) => logged.push(String(line));
  try {
    process.env.FOUNDATION_STAGING_SUPABASE_URL = "https://abcdefghijabcdefghij.supabase.co";
    process.env.FOUNDATION_STAGING_PROJECT_REF = "abcdefghijabcdefghij";
    process.env.FOUNDATION_STAGING_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_synthetic";
    const answer = (missing) => async (url) => {
      const name = url.split("/rpc/")[1];
      if (name === missing) return Response.json({ code: "PGRST202" }, { status: 404 });
      return runtime.functions.find((item) => item.name === name).execute.anon
        ? Response.json([])
        : Response.json({ code: "42501" }, { status: 401 });
    };
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal(await main(["--target=staging"], { fetcher: offline }), 0);
    assert.match(logged.join("\n"), /could not be reached.*inconclusive/);
    const paused = async () => new Response("paused", { status: 540 });
    assert.equal(await main(["--target=staging"], { fetcher: paused }), 0);
    assert.match(logged.join("\n"), /inconclusive for commands that answered unexpectedly/);
    assert.equal(await main(["--target=staging"], { fetcher: answer(null) }), 0);
    assert.equal(await main(["--target=staging"], { fetcher: answer(victim.name) }), 1);
    assert.match(logged.join("\n"), /staging database behind by 1/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    names.forEach((name, index) => {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    });
  }
});

test("CI runs the staging check on pull requests only and gives the replay job the base parent", () => {
  const ci = readFileSync(path.join(repo, ".github/workflows/ci.yml"), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  const job = (name) => {
    const start = ci.indexOf(`\n  ${name}:\n`);
    assert.notEqual(start, -1, name);
    const next = ci.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return ci.slice(start, next === -1 ? undefined : start + 1 + next);
  };
  const replay = job("foundation-replay");
  assert.match(replay, /fetch-depth: 2/);
  assert.match(replay, /node scripts\/check-foundation-update-order\.mjs --base/);
  assert.match(job("staging-database-config"), /\n {4}if: github\.event_name == 'pull_request'\n/);
  const check = job("staging-database");
  assert.match(check, /\n {4}needs: staging-database-config\n/);
  assert.match(
    check,
    /\n {4}if: github\.event_name == 'pull_request' && needs\.staging-database-config\.outputs\.configured == 'true'\n/
  );
});

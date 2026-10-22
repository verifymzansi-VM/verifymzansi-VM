import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { assertFixturePath } from "./foundation-native-paths.mjs";

const forbidden = new Set([
  "grant_intro_trial",
  "record_identity_ban",
  "transport_resource",
  "rename_transport_resource",
  "enqueue_transport_reconciliation",
  "reconcile_transport_item",
]);
const scalarTypes = new Map([
  ["uuid", "string"],
  ["text", "string"],
  ["integer", "number"],
  ["boolean", "boolean"],
  ["timestamp with time zone", "string"],
  ["jsonb", "Json"],
  // Bounded id lists (for example mark_my_notifications_read); SQL validates
  // cardinality and null elements.
  ["uuid[]", "string[]"],
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");

// The generator's TypeScript is parsed as syntax, never evaluated. Checking the
// complete schema/function/argument keys prevents silently publishing fixture
// types or accepting a partial generator response as an application contract.
export function inspectApiTypes(source, functions) {
  const file = ts.createSourceFile(
    "database.types.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  assert.equal(file.parseDiagnostics.length, 0, "Invalid generated TypeScript");
  const database = file.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === "Database"
  );
  assert.ok(database && ts.isTypeLiteralNode(database.type), "Database type missing");
  const properties = (node) => {
    assert.ok(ts.isTypeLiteralNode(node));
    assert.ok(
      node.members.every(ts.isPropertySignature),
      "Index/call/method members are prohibited"
    );
    const pairs = node.members.map((member) => {
      assert.ok(
        ts.isIdentifier(member.name) || ts.isStringLiteral(member.name),
        "Computed property prohibited"
      );
      return [member.name.text, member];
    });
    assert.equal(
      new Set(pairs.map(([name]) => name)).size,
      pairs.length,
      "Duplicate generated property"
    );
    return new Map(pairs);
  };
  const schemas = properties(database.type);
  assert.deepEqual(
    [...schemas.keys()],
    ["api"],
    "Only the intentional api schema may be generated"
  );
  const api = properties(schemas.get("api").type);
  assert.deepEqual(
    [...api.keys()].sort(),
    ["Tables", "Views", "Functions", "Enums", "CompositeTypes"].sort()
  );
  for (const kind of ["Tables", "Views", "Enums", "CompositeTypes"]) {
    assert.ok(api.has(kind));
    const type = api.get(kind).type;
    const empty = ts.isTypeLiteralNode(type)
      ? type.members.length === 0
      : ts.isMappedTypeNode(type) &&
        /^\{\[_innever\]:never;?\}$/.test(type.getText(file).replaceAll(/\s/g, ""));
    assert.ok(empty, `No ${kind} should be exposed`);
  }
  const actual = properties(api.get("Functions").type);
  assert.deepEqual(
    [...actual.keys()].sort(),
    functions.map((fn) => fn.name).sort(),
    "Generated RPC manifest drift"
  );
  for (const fn of functions) {
    assert.equal(forbidden.has(fn.name), false, "Fixture command in clean API");
    const declaration = properties(actual.get(fn.name).type);
    assert.deepEqual([...declaration.keys()].sort(), ["Args", "Returns"]);
    const args = declaration.get("Args").type;
    if (fn.arguments.length === 0) {
      assert.equal(args.getText(file).replaceAll(/\s/g, ""), "Record<PropertyKey,never>");
    } else {
      const members = properties(args);
      assert.deepEqual([...members.keys()].sort(), fn.arguments.map((arg) => arg.name).sort());
      for (const arg of fn.arguments) {
        assert.equal(
          Boolean(members.get(arg.name).questionToken),
          arg.optional,
          `${fn.name}.${arg.name} optionality`
        );
        assert.ok(scalarTypes.has(arg.sqlType), "Unreviewed SQL argument type");
        // The raw generator writes (string)[]; Prettier writes string[].
        const text = members.get(arg.name).type.getText(file);
        assert.equal(
          text.startsWith("(") && text.endsWith(")[]") ? text.slice(1, -3) + "[]" : text,
          scalarTypes.get(arg.sqlType),
          `${fn.name}.${arg.name} type`
        );
      }
    }
    assert.ok(declaration.has("Returns"));
    assert.ok(scalarTypes.has(fn.returns), "Unreviewed SQL return type");
    assert.equal(
      declaration.get("Returns").type.getText(file),
      scalarTypes.get(fn.returns),
      `${fn.name} result type`
    );
  }
  return actual.size;
}

export function cleanTypesDatabaseUri(raw, database) {
  assert.equal(database, "foundation_baseline_replay");
  const uri = new URL(raw);
  assert.ok(["postgres:", "postgresql:"].includes(uri.protocol));
  assert.equal(uri.username, "postgres");
  assert.equal(uri.hostname, "127.0.0.1");
  assert.equal(uri.port, "55442");
  assert.equal(uri.pathname, "/postgres");
  assert.equal(uri.search, "");
  assert.equal(uri.hash, "");
  uri.pathname = `/${database}`;
  return uri;
}

export function assertCompleteFoundationSources(recorded, registered) {
  assert.deepEqual(
    Object.keys(recorded).sort(),
    [...registered].sort(),
    "Foundation migration source set changed; fresh native/baseline assembly required"
  );
}

export function roleTypeSource(functions) {
  const aliases = [
    ["Public", "anon"],
    ["Authenticated", "authenticated"],
    ["Service", "service_role"],
  ];
  return (
    "// Generated from fresh clean-baseline EXECUTE grants. Body authorization is still required.\n" +
    'import type { Database } from "./api.types";\n' +
    'type Api = Database["api"];\n' +
    aliases
      .map(
        ([name, role]) =>
          `export type Foundation${name}Database = { api: Omit<Api, "Functions"> & { Functions: Pick<Api["Functions"], ${
            functions
              .filter((fn) => fn.execute[role])
              .map((fn) => JSON.stringify(fn.name))
              .join(" | ") || "never"
          }> } };`
      )
      .join("\n") +
    "\n"
  );
}

export function generateCleanApiContracts({ sql, database, env, cliPath, workdir, candidateHash }) {
  assert.equal(database, "foundation_baseline_replay");
  const functions = JSON.parse(
    sql(
      `
    select json_agg(json_build_object(
      'name',p.proname,
      'signature',pg_get_function_identity_arguments(p.oid),
      'argumentsWithDefaults',pg_get_function_arguments(p.oid),
      'returns',pg_get_function_result(p.oid),
      'volatility',p.provolatile,
      'securityDefiner',p.prosecdef,
      'owner',pg_get_userbyid(p.proowner),
      'searchPath',p.proconfig,
      'arguments',coalesce((select json_agg(json_build_object(
        'name',p.proargnames[a.ordinality],
        'sqlType',format_type(a.type_oid,null),
        'optional',a.ordinality>p.pronargs-p.pronargdefaults
      ) order by a.ordinality) from unnest(p.proargtypes::oid[]) with ordinality a(type_oid,ordinality)),'[]'::json),
      'execute',json_build_object(
        'anon',has_function_privilege('anon',p.oid,'execute'),
        'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
        'service_role',has_function_privilege('service_role',p.oid,'execute'))
    ) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api';`,
      database
    )
  );
  assert.equal(
    new Set(functions.map((fn) => fn.name)).size,
    functions.length,
    "RPC overloads need explicit reviewed contracts"
  );
  for (const fn of functions) {
    assert.equal(fn.owner, "postgres");
    assert.equal(forbidden.has(fn.name), false);
    assert.ok(
      fn.arguments.every((arg) => typeof arg.name === "string" && /^p_[a-z0-9_]+$/.test(arg.name))
    );
  }
  const cli = (args) =>
    execFileSync(process.execPath, [cliPath, ...args, "--workdir", workdir], {
      env,
      cwd: workdir,
      encoding: "utf8",
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  // Credentials stay in memory/captured process arguments; never in evidence or errors.
  const status = JSON.parse(cli(["status", "-o", "json"]));
  const uri = cleanTypesDatabaseUri(status.DB_URL, database);
  const version = cli(["--version"]).trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const generated = cli([
    "gen",
    "types",
    "--db-url",
    uri.toString(),
    "--schema",
    "api",
    "--lang",
    "typescript",
    "--query-timeout",
    "15s",
  ]);
  const count = inspectApiTypes(generated, functions);
  const formatted = execFileSync(
    process.execPath,
    [
      "node_modules/prettier/bin/prettier.cjs",
      "--stdin-filepath",
      "src/lib/foundation/database.types.ts",
    ],
    {
      input: generated,
      encoding: "utf8",
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  inspectApiTypes(formatted, functions);
  const typesPath = "database/foundation/api.types.ts";
  const manifestPath = "database/foundation/api-manifest.json";
  const rolesPath = "database/foundation/api-role-types.ts";
  const roles = roleTypeSource(functions);
  assert.equal(typeof roles, "string");
  assert.ok(roles.includes("export type FoundationPublicDatabase"));
  const formattedRoles = execFileSync(
    process.execPath,
    ["node_modules/prettier/bin/prettier.cjs", "--stdin-filepath", rolesPath],
    {
      input: roles,
      encoding: "utf8",
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  const manifest = {
    schemaVersion: 1,
    schema: "api",
    candidateHash,
    generator: {
      tool: "Supabase CLI",
      version,
      schema: "api",
      source: "fresh owned local baseline database; no Auth data",
    },
    generatedTypesHash: hash(formatted),
    roleTypesHash: hash(formattedRoles),
    semanticContractStatus:
      "INCOMPLETE: audience, current authority, resource scope, strict DTO, audit, cache, job and retry semantics require individual adapter review",
    authorityScope:
      "SQL EXECUTE eligibility only; current caller/session/capability/ownership checks remain in function bodies. Generated Json is not runtime DTO validation.",
    releaseReady: false,
    functions,
  };
  // Validate every output path as well as both complete contracts before replacement.
  for (const target of [typesPath, rolesPath, manifestPath])
    assertFixturePath(process.cwd(), target, { allowMissing: true, type: "file" });
  writeFileSync(typesPath, formatted);
  writeFileSync(rolesPath, formattedRoles);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return {
    status: "PASS clean API types and catalogue manifest",
    functionCount: count,
    typesPath,
    typesHash: hash(readFileSync(typesPath)),
    rolesPath,
    rolesHash: hash(readFileSync(rolesPath)),
    manifestPath,
    manifestHash: hash(readFileSync(manifestPath)),
    cliVersion: version,
    candidateHash,
    schema: "api",
    rawFixtureApisAbsent: true,
    roleCounts: Object.fromEntries(
      ["anon", "authenticated", "service_role"].map((role) => [
        role,
        functions.filter((fn) => fn.execute[role]).length,
      ])
    ),
  };
}

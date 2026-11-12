// Checks the reviewed API manifests and the hand-maintained runtime types
// against the `api` schema of the replayed foundation database. Hand-written
// fields (`updates`, `authority`, notes) are not derived and are left alone;
// everything the catalogue can prove (names, arguments, optionality, return
// type, volatility, execute grants and, for the baseline, security and search
// path) must match exactly.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { FOUNDATION_DIR } from "./foundation-replay.mjs";

const BASELINE_MANIFEST = `${FOUNDATION_DIR}/api-manifest.json`;
const RUNTIME_MANIFEST = `${FOUNDATION_DIR}/runtime-api-manifest.json`;
const RUNTIME_TYPES = `${FOUNDATION_DIR}/runtime-api-types.ts`;

/** Same derivation as the clean-baseline contract generator. */
export const API_CATALOGUE_QUERY = `select coalesce(json_agg(json_build_object(
    'name', p.proname,
    'signature', pg_get_function_identity_arguments(p.oid),
    'argumentsWithDefaults', pg_get_function_arguments(p.oid),
    'returns', pg_get_function_result(p.oid),
    'volatility', p.provolatile,
    'securityDefiner', p.prosecdef,
    'owner', pg_get_userbyid(p.proowner),
    'searchPath', p.proconfig,
    'arguments', coalesce((select json_agg(json_build_object(
      'name', p.proargnames[a.ordinality],
      'sqlType', format_type(a.type_oid, null),
      'optional', a.ordinality > p.pronargs - p.pronargdefaults
    ) order by a.ordinality) from unnest(p.proargtypes::oid[]) with ordinality a(type_oid, ordinality)), '[]'::json),
    'execute', json_build_object(
      'anon', has_function_privilege('anon', p.oid, 'execute'),
      'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
      'service_role', has_function_privilege('service_role', p.oid, 'execute'))
  ) order by p.proname collate "C"), '[]'::json) as v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'`;

const RUNTIME_FIELDS = ["arguments", "returns", "volatility", "execute"];
const BASELINE_FIELDS = [
  ...RUNTIME_FIELDS,
  "signature",
  "argumentsWithDefaults",
  "securityDefiner",
  "owner",
  "searchPath",
];

const readJson = (root, file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function readApiSources(root = process.cwd()) {
  return {
    baseline: readJson(root, BASELINE_MANIFEST),
    runtime: readJson(root, RUNTIME_MANIFEST),
    types: readFileSync(path.join(root, RUNTIME_TYPES), "utf8"),
  };
}

/** Lists every difference between the manifests and the replayed `api` schema. */
export function compareApiManifests({ baseline, runtime, catalogue }) {
  const differences = [];
  const live = new Map(catalogue.map((fn) => [fn.name, fn]));
  if (live.size !== catalogue.length)
    differences.push("api: overloaded function names in the replay");
  const listed = new Map();
  for (const [source, manifest, fields] of [
    ["api-manifest.json", baseline, BASELINE_FIELDS],
    ["runtime-api-manifest.json", runtime, RUNTIME_FIELDS],
  ]) {
    for (const fn of manifest.functions) {
      if (listed.has(fn.name)) {
        differences.push(`${fn.name}: listed in both ${listed.get(fn.name)} and ${source}`);
        continue;
      }
      listed.set(fn.name, source);
      const actual = live.get(fn.name);
      if (!actual) {
        differences.push(`${fn.name}: in ${source} but not in the replayed api schema`);
        continue;
      }
      for (const field of fields) {
        if (!same(fn[field], actual[field])) {
          differences.push(
            `${fn.name}.${field}: ${source} has ${JSON.stringify(fn[field])}, replay has ${JSON.stringify(actual[field])}`
          );
        }
      }
    }
  }
  for (const name of live.keys()) {
    if (!listed.has(name))
      differences.push(`${name}: in the replayed api schema but in no manifest`);
  }
  return differences;
}

/** TypeScript spelling of each reviewed SQL type in the runtime types file. */
const TS_TYPES = new Map([
  ["uuid", "string"],
  ["text", "string"],
  ["integer", "number"],
  ["bigint", "number"],
  ["numeric", "number"],
  ["boolean", "boolean"],
  ["timestamp with time zone", "string"],
  ["jsonb", "Json"],
  ["uuid[]", "string[]"],
  ["text[]", "string[]"],
]);
const AUDIENCES = [
  ["anon", "FoundationRuntimePublicDatabase"],
  ["authenticated", "FoundationRuntimeAuthenticatedDatabase"],
  ["service_role", "FoundationRuntimeServiceDatabase"],
];

const propertyName = (member) => member.name?.getText();
const normalise = (text) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\(([A-Za-z]+)\)\[\]/g, "$1[]")
    .trim();

function typeLiteralMembers(node, label) {
  if (!node || !ts.isTypeLiteralNode(node)) throw new Error(`${label}: expected a type literal`);
  return node.members.filter(ts.isPropertySignature);
}

function member(members, name, label) {
  const found = members.find((candidate) => propertyName(candidate) === name);
  if (!found) throw new Error(`${label}: missing ${name}`);
  return found;
}

/**
 * Parses the additive Functions of each runtime audience type:
 * Map<audience, Map<name, { args: Map<arg, { optional, type }>, returns }>>.
 */
function parseRuntimeTypes(source) {
  const file = ts.createSourceFile(RUNTIME_TYPES, source, ts.ScriptTarget.Latest, true);
  const aliases = new Map();
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement.type);
  }
  const result = new Map();
  for (const [audience, alias] of AUDIENCES) {
    const root = typeLiteralMembers(aliases.get(alias), alias);
    const api = member(root, "api", alias).type;
    if (!ts.isIntersectionTypeNode(api)) throw new Error(`${alias}.api: expected an intersection`);
    const functions = member(
      typeLiteralMembers(api.types.at(-1), `${alias}.api`),
      "Functions",
      alias
    ).type;
    if (!ts.isIntersectionTypeNode(functions)) {
      throw new Error(`${alias}.api.Functions: expected baseline & additions`);
    }
    const additions = new Map();
    for (const fn of typeLiteralMembers(functions.types.at(-1), `${alias}.api.Functions`)) {
      const name = propertyName(fn);
      const members = typeLiteralMembers(fn.type, `${alias}.${name}`);
      const argsNode = member(members, "Args", `${alias}.${name}`).type;
      const args = new Map();
      if (ts.isTypeLiteralNode(argsNode)) {
        for (const arg of argsNode.members.filter(ts.isPropertySignature)) {
          args.set(propertyName(arg), {
            optional: Boolean(arg.questionToken),
            type: normalise(arg.type.getText()),
          });
        }
      } else if (!/^Record<(never|PropertyKey), never>$/.test(normalise(argsNode.getText()))) {
        throw new Error(`${alias}.${name}.Args: expected an object type or Record<..., never>`);
      }
      additions.set(name, {
        args,
        returns: normalise(member(members, "Returns", `${alias}.${name}`).type.getText()),
      });
    }
    result.set(audience, additions);
  }
  return result;
}

/**
 * An argument type fits when every member of its union is the SQL type's
 * TypeScript spelling, `null` (SQL arguments accept null) or, for string and
 * number, a literal of that type (a deliberate narrowing such as a status).
 */
export function fitsSqlType(typed, expected) {
  return typed.split(" | ").every((part) => {
    if (part === expected || part === "null") return true;
    if (expected === "string") return /^"[^"]*"$/.test(part);
    if (expected === "number") return /^-?\d+(\.\d+)?$/.test(part);
    return false;
  });
}

/**
 * Every runtime manifest function appears, with matching argument names,
 * optionality and TypeScript types, in exactly the audience types its execute
 * grants allow; nothing else is added there.
 */
export function compareRuntimeTypes(runtime, source) {
  const differences = [];
  const parsed = parseRuntimeTypes(source);
  const manifest = new Map(runtime.functions.map((fn) => [fn.name, fn]));
  for (const [audience, alias] of AUDIENCES) {
    const additions = parsed.get(audience);
    for (const fn of runtime.functions) {
      const typed = additions.get(fn.name);
      if (!fn.execute[audience]) {
        if (typed)
          differences.push(`${alias}.${fn.name}: typed, but ${audience} cannot execute it`);
        continue;
      }
      if (!typed) {
        differences.push(`${alias}.${fn.name}: ${audience} can execute it, but it is not typed`);
        continue;
      }
      const names = fn.arguments.map((arg) => arg.name);
      if (!same(names, [...typed.args.keys()])) {
        differences.push(
          `${alias}.${fn.name}.Args: names ${JSON.stringify([...typed.args.keys()])}, manifest ${JSON.stringify(names)}`
        );
      }
      for (const arg of fn.arguments) {
        const typedArg = typed.args.get(arg.name);
        if (!typedArg) continue;
        const expected = TS_TYPES.get(arg.sqlType);
        if (!expected)
          differences.push(`${fn.name}.${arg.name}: unreviewed SQL type ${arg.sqlType}`);
        else if (!fitsSqlType(typedArg.type, expected)) {
          differences.push(
            `${alias}.${fn.name}.${arg.name}: typed ${typedArg.type}, SQL ${arg.sqlType} needs ${expected}`
          );
        }
        if (typedArg.optional !== arg.optional) {
          differences.push(
            `${alias}.${fn.name}.${arg.name}: typed ${typedArg.optional ? "optional" : "required"}, SQL ${arg.optional ? "has a default" : "has no default"}`
          );
        }
      }
      const returns = TS_TYPES.get(fn.returns);
      if (!returns) differences.push(`${fn.name}: unreviewed SQL return type ${fn.returns}`);
      else if (typed.returns !== returns) {
        differences.push(
          `${alias}.${fn.name}.Returns: typed ${typed.returns}, SQL ${fn.returns} needs ${returns}`
        );
      }
    }
    for (const name of additions.keys()) {
      if (!manifest.has(name))
        differences.push(`${alias}.${name}: typed but not in runtime-api-manifest.json`);
    }
  }
  return differences;
}

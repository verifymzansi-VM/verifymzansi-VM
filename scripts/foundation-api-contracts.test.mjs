import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompleteFoundationSources,
  cleanTypesDatabaseUri,
  inspectApiTypes,
  roleTypeSource,
} from "./lib/foundation-api-contracts.mjs";

const raw = "postgresql://postgres@127.0.0.1:55442/postgres";
const functions = [
  {
    name: "test_command",
    returns: "jsonb",
    arguments: [
      { name: "p_id", sqlType: "uuid", optional: false },
      { name: "p_limit", sqlType: "integer", optional: true },
    ],
  },
];
const source = `export type Database = { api: {
  Tables: { [_ in never]: never }; Views: { [_ in never]: never };
  Enums: { [_ in never]: never }; CompositeTypes: { [_ in never]: never };
  Functions: { test_command: { Args: { p_id: string; p_limit?: number }; Returns: Json } };
} };`;

test("generation URI can address only the fresh database on the owned loopback port", () => {
  const uri = cleanTypesDatabaseUri(raw, "foundation_baseline_replay");
  assert.equal(uri.pathname, "/foundation_baseline_replay");
  assert.equal(uri.hostname, "127.0.0.1");
  for (const value of [
    raw + "?host=remote.example",
    raw + "#fragment",
    raw.replace("127.0.0.1", "remote.example"),
    raw.replace("55442", "5432"),
    raw.replace("postgres@", "authenticator@"),
    raw.replace("/postgres", "/other"),
    raw.replace("postgresql:", "https:"),
  ])
    assert.throws(() => cleanTypesDatabaseUri(value, "foundation_baseline_replay"));
  assert.throws(() => cleanTypesDatabaseUri(raw, "postgres"));
});

test("API type AST matches exact schema, RPC names, arguments and default optionality", () => {
  assert.equal(inspectApiTypes(source, functions), 1);
  for (const value of [
    source.replace("api:", "private:"),
    source.replace("p_id: string", "p_id?: string"),
    source.replace("p_id: string", "p_id: string; p_id: number"),
    source.replace("Functions: {", "Functions: { [key: string]: unknown;"),
    source.replace("Args: {", "Args: { [key: string]: unknown;"),
    source.replace("p_id: string", "p_id: number"),
    source.replace("Returns: Json", "Returns: unknown"),
    source.replace("p_limit?:", "p_limit:"),
    source.replace("p_limit?: number", "p_other?: number"),
    source.replace("test_command:", "raw_command:"),
    source.replace("Functions: {", "Functions: { unexpected: { Args: {}; Returns: Json };"),
    source.replace("Tables: { [_ in never]: never }", "Tables: { secrets: { Row: unknown } }"),
    source.replace("Tables: { [_ in never]: never }", "Tables: { [key: string]: unknown }"),
    source.slice(0, -5),
  ])
    assert.throws(() => inspectApiTypes(value, functions));
});

test("an exact manifest match cannot legitimise forbidden fixture identity APIs", () => {
  for (const name of [
    "grant_intro_trial",
    "record_identity_ban",
    "rename_transport_resource",
    "enqueue_transport_reconciliation",
  ])
    assert.throws(() =>
      inspectApiTypes(source.replace("test_command:", `${name}:`), [{ ...functions[0], name }])
    );
});

test("zero-argument RPCs must have the generator's closed empty argument record", () => {
  const empty = source.replace("{ p_id: string; p_limit?: number }", "Record<PropertyKey, never>");
  assert.equal(
    inspectApiTypes(empty, [{ name: "test_command", returns: "jsonb", arguments: [] }]),
    1
  );
  assert.throws(() =>
    inspectApiTypes(empty.replace("Record<PropertyKey, never>", "Record<string, unknown>"), [
      { name: "test_command", returns: "jsonb", arguments: [] },
    ])
  );
});

test("role aliases are nonempty and contain only each role's observed RPC grants", () => {
  const text = roleTypeSource([
    { name: "public_read", execute: { anon: true, authenticated: true, service_role: false } },
    { name: "owner_command", execute: { anon: false, authenticated: true, service_role: false } },
    { name: "service_command", execute: { anon: false, authenticated: false, service_role: true } },
  ]);
  assert.equal(typeof text, "string");
  assert.match(text, /FoundationPublicDatabase[^\n]+"public_read"[^\n]+/);
  assert.match(text, /FoundationAuthenticatedDatabase[^\n]+"public_read" \| "owner_command"/);
  assert.match(text, /FoundationServiceDatabase[^\n]+"service_command"/);
  const publicLine = text
    .split("\n")
    .find((line) => line.includes("export type FoundationPublicDatabase"));
  assert.equal(publicLine.includes("owner_command"), false);
  assert.equal(publicLine.includes("service_command"), false);
});

test("new or removed migration sources cannot retain an apparently current old baseline", () => {
  assert.doesNotThrow(() =>
    assertCompleteFoundationSources({ a: "digest", b: "digest" }, ["b", "a"])
  );
  assert.throws(() => assertCompleteFoundationSources({ a: "digest" }, ["a", "new_migration"]));
  assert.throws(() => assertCompleteFoundationSources({ a: "digest", removed: "digest" }, ["a"]));
});

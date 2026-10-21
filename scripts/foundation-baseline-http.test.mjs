import assert from "node:assert/strict";
import { test } from "node:test";
import { baselineDatabaseUri } from "./lib/foundation-baseline-http.mjs";
import { baselineAuthDatabaseUri } from "./lib/foundation-baseline-auth.mjs";
import { removeOwnedBaselineContainer } from "./lib/foundation-baseline-container.mjs";

const source = "postgresql://authenticator@supabase_db_backend-foundation-impl:5432/postgres";
test("fresh HTTP proof changes only the verified local database path", () => {
  const uri = baselineDatabaseUri(source, "foundation_baseline_replay");
  assert.equal(uri.hostname, "supabase_db_backend-foundation-impl");
  assert.equal(uri.pathname, "/foundation_baseline_replay");
  assert.equal(uri.username, "authenticator");
  assert.equal(uri.port, "5432");
});
test("libpq connection query overrides and fragment payloads are refused before any process starts", () => {
  for (const suffix of [
    "?host=remote.example",
    "?hostaddr=203.0.113.1",
    "?dbname=postgres",
    "?options=-csearch_path=public",
    "?service=production",
    "?sslmode=disable",
    "#host=remote.example",
  ])
    assert.throws(() => baselineDatabaseUri(source + suffix, "foundation_baseline_replay"));
});
test("unexpected host/principal/port/database/scheme cannot borrow local credentials", () => {
  for (const altered of [
    source.replace("supabase_db_backend-foundation-impl", "remote.example"),
    source.replace("authenticator@", "postgres@"),
    source.replace(":5432/", ":5555/"),
    source.replace("/postgres", "/other"),
    source.replace("postgresql:", "https:"),
  ])
    assert.throws(() => baselineDatabaseUri(altered, "foundation_baseline_replay"));
  assert.throws(() => baselineDatabaseUri(source, "postgres"));
});

test("clean Auth process can use only its own local role and fresh database", () => {
  const authSource = source.replace("authenticator@", "supabase_auth_admin@");
  const uri = baselineAuthDatabaseUri(authSource, "foundation_baseline_replay");
  assert.equal(uri.username, "supabase_auth_admin");
  assert.equal(uri.pathname, "/foundation_baseline_replay");
  assert.equal(uri.hostname, "supabase_db_backend-foundation-impl");
  for (const raw of [
    source,
    authSource.replace("supabase_db_backend-foundation-impl", "remote.example"),
    authSource.replace(":5432/", ":5555/"),
    authSource.replace("/postgres", "/other"),
    authSource + "?options=-csearch_path=public",
    authSource + "?dbname=postgres",
    authSource + "#remote",
  ])
    assert.throws(() => baselineAuthDatabaseUri(raw, "foundation_baseline_replay"));
  assert.throws(() => baselineAuthDatabaseUri(authSource, "postgres"));
});

test("cleanup verifies exact ownership, including a lost create response", () => {
  const nonce = "00000000-0000-4000-8000-000000000001",
    id = "a".repeat(64);
  for (const ownedId of [id, undefined]) {
    const calls = [];
    const removed = removeOwnedBaselineContainer({
      name: "vm-foundation-baseline-auth",
      label: "vm.foundation.auth-proof",
      nonce,
      ownedId,
      createAttempted: true,
      inspect: () => ({ Id: id, Config: { Labels: { "vm.foundation.auth-proof": nonce } } }),
      docker: (args) => {
        calls.push(args);
        return args[0] === "ps" ? id : "";
      },
    });
    assert.equal(removed, true);
    assert.deepEqual(calls.at(-1), ["rm", "--force", id]);
  }
});

test("cleanup never inspects or removes pre-existing or mismatched resources", () => {
  const nonce = "00000000-0000-4000-8000-000000000001",
    id = "a".repeat(64),
    calls = [];
  const args = {
    name: "vm-foundation-baseline-http",
    label: "vm.foundation.http-proof",
    nonce,
    createAttempted: false,
    docker: (action) => {
      calls.push(action);
      return id;
    },
    inspect: () => {
      throw new Error("must not inspect unowned resources");
    },
  };
  assert.equal(removeOwnedBaselineContainer(args), false);
  assert.equal(calls.length, 0);
  assert.throws(() =>
    removeOwnedBaselineContainer({
      ...args,
      createAttempted: true,
      ownedId: id,
      inspect: () => ({ Config: { Labels: { "vm.foundation.http-proof": "foreign" } } }),
    })
  );
  assert.equal(calls.length, 0);
  assert.throws(() => removeOwnedBaselineContainer({ ...args, name: "production" }));
  assert.equal(calls.length, 0);
});

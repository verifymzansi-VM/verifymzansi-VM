import assert from "node:assert/strict";
import { test } from "node:test";
import { baselineDatabaseUri } from "./lib/foundation-baseline-http.mjs";

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

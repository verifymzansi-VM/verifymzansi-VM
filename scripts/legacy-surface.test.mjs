import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  baselineFrom,
  compareWithBaseline,
  definedFunctionNames,
  isScannedFile,
  measureLegacySurface,
  resolveSpecifier,
  topFiles,
} from "./lib/legacy-surface.mjs";

const names = {
  apiNames: new Set(["submit_enquiry", "get_public_posts"]),
  retiredFunctionNames: new Set(["record_site_visit", "staff_session_is_active", "submit_enquiry"]),
};
const measure = (files) => measureLegacySurface(files, names);

test("scans production sources only", () => {
  assert.equal(isScannedFile("src/app/api/contact/route.ts"), true);
  assert.equal(isScannedFile("src/components/listings/card.tsx"), true);
  assert.equal(isScannedFile("workers/ops/index.mjs"), true);
  assert.equal(isScannedFile("src/app/api/contact/route.test.ts"), false);
  assert.equal(isScannedFile("src/__tests__/contact.ts"), false);
  assert.equal(isScannedFile("src/test/setup.ts"), false);
  assert.equal(isScannedFile("src/types/env.d.ts"), false);
  assert.equal(isScannedFile("scripts/check-legacy-surface.mjs"), false);
  assert.equal(isScannedFile("src/app/globals.css"), false);
});

test("resolves alias and relative specifiers to repository paths", () => {
  assert.equal(
    resolveSpecifier("src/app/x/route.ts", "@/lib/supabase/admin"),
    "src/lib/supabase/admin"
  );
  assert.equal(
    resolveSpecifier("src/lib/foundation/a.ts", "../supabase/client"),
    "src/lib/supabase/client"
  );
  assert.equal(resolveSpecifier("src/lib/supabase/x.ts", "./server.ts"), "src/lib/supabase/server");
  assert.equal(resolveSpecifier("src/lib/a.ts", "./supabase/index"), "src/lib/supabase");
  assert.equal(resolveSpecifier("src/lib/a.ts", "@supabase/supabase-js"), null);
});

test("counts every form of import of the three retired clients, once per file", () => {
  const result = measure([
    {
      path: "src/a.ts",
      text: 'import { createAdminClient } from "@/lib/supabase/admin";\nimport { createClient } from "@/lib/supabase/server";',
    },
    { path: "src/b.ts", text: 'const { createClient } = await import("@/lib/supabase/client");' },
    { path: "src/lib/c.ts", text: "import type { createAdminClient } from './supabase/admin';" },
    { path: "src/lib/foundation/d.ts", text: 'export { createClient } from "../supabase/client";' },
    {
      path: "src/e.ts",
      text: 'import { createPlaywrightStubSupabaseClient } from "@/lib/supabase/playwright-stub";',
    },
    {
      path: "src/f.ts",
      text: 'import { getRestoredFoundationBrowserClient } from "@/lib/foundation/restored-browser-client";',
    },
  ]);
  assert.deepEqual(result.legacyClientImporters, [
    "src/a.ts",
    "src/b.ts",
    "src/lib/c.ts",
    "src/lib/foundation/d.ts",
  ]);
  assert.equal(result.counts.legacyClientImports, 4);
});

test("counts backend switches", () => {
  const result = measure([
    {
      path: "src/a.ts",
      text: 'if (getDataBackend() === "foundation") return x;\nconst b = getDataBackend ( );',
    },
    {
      path: "src/b.ts",
      text: "export function getDataBackendLabel() {}\nimport { getDataBackend } from '@/lib/data-backend';",
    },
  ]);
  assert.equal(result.counts.backendSwitches, 2);
  assert.equal(result.perFile["src/a.ts"].backendSwitches, 2);
});

test("retired command names exclude foundation api commands and include wrapper literals", () => {
  const result = measure([
    {
      path: "src/a.ts",
      text: [
        'await admin.rpc("record_site_visit", { p_path: path });',
        "await admin.rpc('record_site_visit');",
        'await client.rpc<Row>(\n  "submit_enquiry", {});',
        'await client.rpc("never_defined_anywhere");',
      ].join("\n"),
    },
    {
      path: "src/staff-session.ts",
      text: 'type Fn = "staff_session_is_active" | "submit_enquiry";\nconst run = (fn: Fn) => admin.rpc(fn, {});',
    },
    // Without a dynamic .rpc() call, a matching string literal is not a command.
    { path: "src/label.ts", text: 'const label = "staff_session_is_active";' },
  ]);
  assert.deepEqual(result.retiredCommandNames, [
    "never_defined_anywhere",
    "record_site_visit",
    "staff_session_is_active",
  ]);
  assert.equal(result.counts.retiredCommandNames, 3);
  assert.equal(result.counts.retiredCommandCalls, 3);
});

test("retired table reads skip Storage buckets and typed-array helpers", () => {
  const result = measure([
    {
      path: "src/a.ts",
      text: [
        'await admin.from("listings").select("id");',
        'await admin\n  .from("account_profiles")\n  .select("id");',
        'await (await createClient()).from("listings").select("*");',
        'await supabase.storage.from("avatars").upload(path, file);',
        'Buffer.from("abc", "utf8");',
        'Array.from("abc");',
        "admin.from(tableName);",
      ].join("\n"),
    },
  ]);
  assert.equal(result.counts.retiredTableReads, 3);
  assert.deepEqual(result.retiredTableNames, ["account_profiles", "listings"]);
  assert.deepEqual(topFiles(result.perFile, "retiredTableReads"), ["src/a.ts (3)"]);
});

test("retired table reads include tables named through string constants", () => {
  const result = measure([
    {
      path: "src/lib/account/compat.ts",
      text: [
        'export const PROFILE_TABLE = "account_profiles";',
        "export const PROFILE_WRITE_TABLE = PROFILE_TABLE;",
        'export const TABLES = ["listings", "leads"] as const;',
        "export const LIMIT = MAX_ROWS * 2;",
      ].join("\n"),
    },
    {
      path: "src/app/page.tsx",
      text: [
        'import { PROFILE_TABLE, PROFILE_WRITE_TABLE } from "@/lib/account/compat";',
        "await supabase\n  .from(PROFILE_TABLE)\n  .select('phone');",
        "await supabase.from(PROFILE_WRITE_TABLE).update({});",
        // Not tables: arrays, unknown names, lower-case variables, typed-array helpers.
        "Array.from(TABLES);",
        "client.from(TABLES);",
        "client.from(NOT_DEFINED_ANYWHERE);",
        "client.from(tableName);",
      ].join("\n"),
    },
    {
      path: "src/b.ts",
      // A file's own definition wins over one elsewhere.
      text: 'const PROFILE_TABLE = "payments";\nawait admin.from(PROFILE_TABLE, { schema: "x" });',
    },
  ]);
  assert.equal(result.counts.retiredTableReads, 3);
  assert.deepEqual(result.retiredTableNames, ["account_profiles", "payments"]);
  assert.equal(result.perFile["src/app/page.tsx"].retiredTableReads, 2);
  assert.equal(result.perFile["src/b.ts"].retiredTableReads, 1);
});

test("constant table reads cover let/var, type annotations, casts and namespace access", () => {
  const result = measure([
    {
      path: "src/lib/account/compat.ts",
      text: [
        'export let LET_TABLE = "listings";',
        'var VAR_TABLE: string | undefined = "leads";',
        'export const TYPED_TABLE: TableName = "payments";',
        'const PROFILE_TABLE = "account_profiles" as const;',
        // A function type's arrow does not turn into a table name.
        'const HANDLER: (a: string) => void = "not_a_table";',
      ].join("\n"),
    },
    {
      path: "src/app/page.tsx",
      text: [
        'import * as compat from "@/lib/account/compat";',
        "await supabase.from(LET_TABLE).select('id');",
        "await supabase.from(VAR_TABLE).select('id');",
        "await supabase.from(TYPED_TABLE).select('id');",
        "await supabase.from(PROFILE_TABLE as never).select('id');",
        "await supabase.from(PROFILE_TABLE as Record<string, never>).select('id');",
        "await supabase.from(compat.PROFILE_TABLE).select('id');",
        "await supabase.from(HANDLER).select('id');",
        // Non-database helpers named by an ignored receiver.
        "Readable.from(PROFILE_TABLE);",
        "stream.Readable.from(PROFILE_TABLE);",
        "ReadableStream.from(PROFILE_TABLE);",
        'Readable.from("account_profiles");',
        "Array.from(PROFILE_TABLE);",
        "Buffer.from(PROFILE_TABLE as string, 'utf8');",
      ].join("\n"),
    },
    {
      path: "src/b.ts",
      // A qualified name refers to the other module, not this file's constant.
      text: 'const PROFILE_TABLE = "payments";\nawait admin.from(compat.PROFILE_TABLE);',
    },
  ]);
  assert.equal(result.perFile["src/app/page.tsx"].retiredTableReads, 6);
  assert.equal(result.perFile["src/b.ts"].retiredTableReads, 1);
  assert.equal(result.counts.retiredTableReads, 7);
  assert.deepEqual(result.retiredTableNames, ["account_profiles", "leads", "listings", "payments"]);
});

test("documented limits: what a regex cannot follow", () => {
  // The first four are real table reads the counter misses; the last is a
  // non-database call it still counts. Fixing either needs a TypeScript parser
  // (see the comment on TABLE_CONSTANT in scripts/lib/legacy-surface.mjs). If
  // this count changes, update this test and that comment together.
  const result = measure([
    {
      path: "src/lib/account/compat.ts",
      text: [
        'export const PROFILE_TABLE = "account_profiles";',
        'export const TABLES = { PROFILE: "account_profiles" } as const;',
        'export const PREFIX = "account";',
      ].join("\n"),
    },
    {
      path: "src/app/page.tsx",
      text: [
        'import { PROFILE_TABLE as T } from "@/lib/account/compat";',
        "await supabase.from(T).select('id');", // import rename
        "await supabase.from(TABLES.PROFILE).select('id');", // object member
        "const table = PROFILE_TABLE;\nawait supabase.from(table).select('id');", // lower-case copy
        "await supabase.from(`${PREFIX}_profiles`).select('id');", // computed name
        // A helper whose receiver is not the word before `.from` still counts.
        "const R = Readable;\nR.from(PROFILE_TABLE);",
      ].join("\n"),
    },
  ]);
  assert.equal(result.perFile["src/app/page.tsx"]?.retiredTableReads, 1);
});

test("reads function names from the retired migration tree", () => {
  const sql = [
    "create or replace function public.record_site_visit(p_path text) returns void",
    'CREATE FUNCTION "public"."staff_access_of"(p_user uuid)',
    "create function toggle_content_like ()",
    "create or replace function private.not_public(x int)",
  ].join(";\n");
  assert.deepEqual([...definedFunctionNames([sql])].sort(), [
    "record_site_visit",
    "staff_access_of",
    "toggle_content_like",
  ]);
});

test("the ratchet fails on rises and on unrecorded falls", () => {
  const files = [
    {
      path: "src/a.ts",
      text: 'import { createAdminClient } from "@/lib/supabase/admin";\nawait createAdminClient().from("listings");\nif (getDataBackend() === "foundation") {}\nadmin.rpc("record_site_visit");',
    },
  ];
  const current = measure(files);
  const baseline = baselineFrom(current);
  assert.deepEqual(compareWithBaseline(current, baseline), { rises: [], falls: [] });

  const grown = measure([
    ...files,
    {
      path: "src/b.ts",
      text: 'import { createClient } from "@/lib/supabase/server";\nawait c.from("payments");\nc.rpc("toggle_content_like");',
    },
  ]);
  const { rises } = compareWithBaseline(grown, baseline);
  assert.ok(rises.includes("legacyClientImports rose from 1 to 2"));
  assert.ok(rises.includes("retiredTableReads rose from 1 to 2"));
  assert.ok(rises.includes("retiredCommandCalls rose from 1 to 2"));
  assert.ok(rises.includes("new file importing a retired client: src/b.ts"));
  assert.ok(rises.includes("new retired command name: toggle_content_like"));
  assert.ok(rises.includes("new retired table name: payments"));

  // Swapping one name for another keeps the count but is still new surface.
  const swapped = measure([
    { path: "src/a.ts", text: files[0].text.replace("record_site_visit", "toggle_content_like") },
  ]);
  const swap = compareWithBaseline(swapped, baseline);
  assert.deepEqual(swap.rises, ["new retired command name: toggle_content_like"]);
  assert.deepEqual(swap.falls, ["retired command name gone: record_site_visit"]);

  const shrunk = measure([{ path: "src/a.ts", text: "export {};" }]);
  const result = compareWithBaseline(shrunk, baseline);
  assert.deepEqual(result.rises, []);
  assert.ok(result.falls.includes("backendSwitches fell from 1 to 0"));
  assert.ok(result.falls.includes("file importing a retired client gone: src/a.ts"));
  // A lowered baseline then passes and cannot grow back.
  const lowered = baselineFrom(shrunk);
  assert.deepEqual(compareWithBaseline(shrunk, lowered), { rises: [], falls: [] });
  assert.ok(compareWithBaseline(current, lowered).rises.length > 0);
});

test("a baseline missing a count fails instead of passing silently", () => {
  const current = measure([]);
  const { rises } = compareWithBaseline(current, {
    counts: {},
    legacyClientImporters: [],
    retiredCommandNames: [],
    retiredTableNames: [],
  });
  assert.equal(rises.length, 5);
});

test("the committed baseline is sorted, unique and feeds the dependency rule", () => {
  const baseline = JSON.parse(readFileSync("scripts/legacy-surface-baseline.json", "utf8"));
  for (const key of ["legacyClientImporters", "retiredCommandNames", "retiredTableNames"]) {
    assert.deepEqual([...baseline[key]].sort(), baseline[key], `${key} is sorted`);
    assert.equal(new Set(baseline[key]).size, baseline[key].length, `${key} is unique`);
  }
  assert.equal(baseline.counts.legacyClientImports, baseline.legacyClientImporters.length);
  assert.equal(baseline.counts.retiredCommandNames, baseline.retiredCommandNames.length);
  const config = readFileSync(".dependency-cruiser.cjs", "utf8");
  assert.match(config, /no-new-legacy-supabase-client/);
  assert.match(config, /legacy-surface-baseline\.json/);
});

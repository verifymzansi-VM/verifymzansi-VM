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

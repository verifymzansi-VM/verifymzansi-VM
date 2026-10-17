import test from "node:test";
import assert from "node:assert/strict";
import { buildContracts } from "./apply-field-contracts.mjs";

const ledger = {
  records: [
    { id: "public.t.a", kind: "column", source: { table: "public.t", column: "a" } },
    { id: "public.t.b", kind: "column", source: { table: "public.t", column: "b" } },
    { id: "src/app/api/x/route.ts", kind: "route", source: { methods: ["GET", "POST"] } },
  ],
};
const full = {
  input: "owner form",
  output: "owner DTO",
  privacy: "private",
  display: "dashboard",
  filter: "none here",
  edit: "owner only",
  retention: "with the post",
  validation: "bounded text",
  tests: "native check x",
  sourceEvidence: "src/x.ts",
  dynamicBranches: "none here",
};
const col = (d) => ({ disposition: d, destination: `private.t.${d}` });

test("every column of a covered table needs its own disposition and destination", () => {
  const { errors } = buildContracts(ledger, [
    {
      name: "f.json",
      doc: {
        reviewer: "Reviewer X",
        tables: { "public.t": { defaults: full, columns: { a: col("Carry") } } },
      },
    },
  ]);
  assert.ok(errors.some((e) => e.includes("missing columns b")));
  const shared = buildContracts(ledger, [
    {
      name: "f.json",
      doc: {
        reviewer: "Reviewer X",
        tables: {
          "public.t": {
            defaults: { ...full, disposition: "Carry", destination: "x.y" },
            columns: { a: {}, b: {} },
          },
        },
      },
    },
  ]);
  assert.ok(shared.errors.some((e) => e.includes("needs its own disposition")));
});

test("complete contracts pass and placeholder text fails", () => {
  const ok = buildContracts(ledger, [
    {
      name: "f.json",
      doc: {
        reviewer: "Reviewer X",
        tables: { "public.t": { defaults: full, columns: { a: col("Carry"), b: col("Retire") } } },
      },
    },
  ]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.contracts.get("public.t.a").reviewer, "Reviewer X");
  const bad = buildContracts(ledger, [
    {
      name: "f.json",
      doc: {
        reviewer: "Reviewer X",
        tables: {
          "public.t": {
            defaults: { ...full, retention: "TBD" },
            columns: { a: col("Carry"), b: col("Carry") },
          },
        },
      },
    },
  ]);
  assert.ok(bad.errors.some((e) => e.includes("missing retention")));
});

test("routes need one disposition per method", () => {
  const route = (methods) =>
    buildContracts(ledger, [
      {
        name: "r.json",
        doc: {
          reviewer: "Reviewer X",
          tables: {},
          items: { "src/app/api/x/route.ts": { ...full, ...col("Keep"), methods } },
        },
      },
    ]);
  assert.ok(
    route({ GET: "GET: read thing" }).errors.some((e) => e.includes("missing method POST"))
  );
  assert.deepEqual(route({ GET: "GET: read thing", POST: "POST: write thing" }).errors, []);
});

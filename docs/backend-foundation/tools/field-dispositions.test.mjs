import assert from "node:assert/strict";
import { test } from "node:test";
import { createLedger, checkLedger } from "./field-dispositions.mjs";

test("all source columns, pages and routes enter as unresolved contracts", () => {
  const ledger = createLedger();
  assert.equal(ledger.records.filter((row) => row.kind === "column").length, 1051);
  assert.equal(ledger.records.filter((row) => row.kind === "page").length, 109);
  assert.equal(ledger.records.filter((row) => row.kind === "route").length, 131);
  assert.equal(checkLedger(ledger, createLedger()).status, "INCOMPLETE");
});
test("deleted, duplicate, changed and invented records fail completeness", () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => rows.push(rows[0]),
    (rows) => {
      rows[0].source.column = "invented";
    },
    (rows) => {
      rows[0].id = "invented";
    },
  ]) {
    const ledger = createLedger();
    mutate(ledger.records);
    assert.equal(checkLedger(ledger, createLedger()).status, "FAIL");
  }
});
test("reviewed requires all semantics and every HTTP method; source snapshots cannot drift", () => {
  const ledger = createLedger();
  const route = ledger.records.find((row) => row.kind === "route");
  route.status = "reviewed";
  route.contract = { disposition: "retained" };
  assert.equal(checkLedger(ledger, createLedger()).status, "FAIL");
  const pending = createLedger();
  pending.inputHashes["schema-map.json"] = "changed";
  assert.equal(checkLedger(pending, createLedger()).status, "FAIL");
});

import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";

test("post-field proposals cover source columns without pretending to approve them", () => {
  const root = "docs/backend-foundation";
  const map = JSON.parse(fs.readFileSync(`${root}/schema-map.json`, "utf8"));
  const proposal = JSON.parse(fs.readFileSync(`${root}/post-field-proposals.json`, "utf8"));
  assert.equal(
    proposal.sourceMapHash,
    createHash("sha256")
      .update(fs.readFileSync(`${root}/schema-map.json`))
      .digest("base64url")
  );
  const sourceTypes = new Map(
    map.tables.flatMap((table) =>
      table.currentColumns.map((column) => [`${table.source}.${column.name}`, column.type])
    )
  );
  for (const record of proposal.records)
    assert.equal(record.sourceType, sourceTypes.get(record.source), record.source);
  const expected = map.tables
    .filter((table) =>
      ["public.listings", "public.businesses", "public.promotions"].includes(table.source)
    )
    .flatMap((table) => table.currentColumns.map((column) => `${table.source}.${column.name}`))
    .sort();
  assert.deepEqual(proposal.records.map((record) => record.source).sort(), expected);
  assert.equal(new Set(proposal.records.map((record) => record.source)).size, expected.length);
  assert.deepEqual(proposal.unclassified, []);
  assert(
    proposal.records.every((record) => record.status === "proposal; full field contract pending")
  );
  assert.equal(
    proposal.records.find((record) => record.source === "public.businesses.phone").group,
    "contacts"
  );
  assert.equal(
    proposal.records.find((record) => record.source === "public.promotions.price_cents").group,
    "event-detail"
  );
  assert.equal(
    proposal.records.find(
      (record) => record.source === "public.businesses.cipc_registration_number"
    ).group,
    "trust"
  );
  assert.equal(
    proposal.records.find((record) => record.source === "public.listings.view_count").group,
    "statistics"
  );
});

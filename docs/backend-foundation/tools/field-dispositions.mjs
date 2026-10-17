import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = path.resolve("docs/backend-foundation");
const inputs = [
  "schema-map.json",
  "evidence/page-inventory.json",
  "evidence/route-inventory.json",
  "evidence/source-inventory.json",
];
const hash = (file) =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(root, file)))
    .digest("base64url");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

export function createLedger() {
  const schema = read(inputs[0]);
  const entry = (id, kind, source) => ({ id, kind, source, status: "pending", contract: null });
  return {
    schemaVersion: 1,
    sourceCommit: schema.sourceCommit,
    limitation:
      "Coverage ledger only. Pending records have no reviewed runtime or field semantics.",
    inputHashes: Object.fromEntries(inputs.map((file) => [file, hash(file)])),
    records: [
      ...schema.tables.flatMap((table) =>
        table.currentColumns.map((column) =>
          entry(`${table.source}.${column.name}`, "column", {
            table: table.source,
            column: column.name,
            type: column.type,
          })
        )
      ),
      ...read(inputs[1]).map((page) =>
        entry(page.file, "page", { url: page.url, file: page.file })
      ),
      ...read(inputs[2]).map((route) =>
        entry(route.file, "route", { url: route.url, file: route.file, methods: route.methods })
      ),
    ],
  };
}

const meaningful = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  !/^(pending|tbd|todo|unknown|n\/a)$/i.test(value.trim());
const contractKeys = [
  "disposition",
  "destination",
  "input",
  "output",
  "privacy",
  "display",
  "filter",
  "edit",
  "retention",
  "validation",
  "tests",
  "sourceEvidence",
  "dynamicBranches",
  "reviewer",
];
export function checkLedger(ledger, expected) {
  const errors = [];
  if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger?.records))
    return { status: "FAIL", errors: ["Malformed ledger"] };
  if (JSON.stringify(ledger.inputHashes) !== JSON.stringify(expected.inputHashes))
    errors.push("Input snapshot changed; reconcile dispositions");
  const byId = new Map(ledger.records.map((row) => [row.id, row]));
  if (byId.size !== ledger.records.length) errors.push("Duplicate disposition IDs");
  if (byId.size !== expected.records.length)
    errors.push("Coverage count differs from source inventory");
  for (const record of expected.records) {
    const actual = byId.get(record.id);
    if (
      !actual ||
      actual.kind !== record.kind ||
      JSON.stringify(actual.source) !== JSON.stringify(record.source)
    ) {
      errors.push(`Missing or changed source record: ${record.id}`);
      continue;
    }
    if (!["pending", "reviewed"].includes(actual.status))
      errors.push(`Invalid status: ${record.id}`);
    if (actual.status === "reviewed") {
      for (const key of contractKeys)
        if (!meaningful(actual.contract?.[key]))
          errors.push(`Missing reviewed ${key}: ${record.id}`);
      if (record.kind === "route") {
        for (const method of record.source.methods) {
          if (!meaningful(actual.contract?.methods?.[method]))
            errors.push(`Missing method disposition ${method}: ${record.id}`);
        }
      }
    }
  }
  const pending = ledger.records.filter((row) => row.status === "pending").length;
  return {
    status: errors.length ? "FAIL" : pending ? "INCOMPLETE" : "PASS",
    total: ledger.records.length,
    reviewed: ledger.records.filter((row) => row.status === "reviewed").length,
    pending,
    errors,
    scope:
      "Contract completeness only; named tests/reviewer references still require examined evidence",
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const ledgerPath = path.join(root, "field-dispositions.json");
  if (process.argv[2] === "init") {
    // Exclusive creation prevents a rerun from destroying reviewed decisions.
    fs.writeFileSync(ledgerPath, JSON.stringify(createLedger(), null, 2) + "\n", { flag: "wx" });
    process.stdout.write("Disposition ledger initialized; every record remains pending.\n");
  } else if (process.argv[2] === "check") {
    const result = checkLedger(read("field-dispositions.json"), createLedger());
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.status === "PASS" ? 0 : 1;
  } else {
    console.error("Usage: node docs/backend-foundation/tools/field-dispositions.mjs init|check");
    process.exitCode = 2;
  }
}

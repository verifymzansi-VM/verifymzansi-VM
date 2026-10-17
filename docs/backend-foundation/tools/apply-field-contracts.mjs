// BF-03: merges authored field contracts (docs/backend-foundation/field-contracts/*.json)
// into field-dispositions.json. Every column of a covered table must be listed with its
// own disposition and destination; only shared facts (privacy, retention, tests, ...) may
// come from table defaults. Routes need one disposition per HTTP method.
//
//   node docs/backend-foundation/tools/apply-field-contracts.mjs apply
//   node docs/backend-foundation/tools/apply-field-contracts.mjs check   (no drift, no partial tables)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("docs/backend-foundation");
const KEYS = [
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
const PER_ITEM = ["disposition", "destination"];
const meaningful = (value) =>
  typeof value === "string" &&
  value.trim().length > 3 &&
  !/^(pending|tbd|todo|unknown|n\/a)$/i.test(value.trim());

export function buildContracts(ledger, files) {
  const errors = [];
  const byId = new Map(ledger.records.map((row) => [row.id, row]));
  const columnsByTable = new Map();
  for (const row of ledger.records)
    if (row.kind === "column") {
      const list = columnsByTable.get(row.source.table) ?? [];
      list.push(row.source.column);
      columnsByTable.set(row.source.table, list);
    }
  const out = new Map();
  for (const { name, doc } of files) {
    if (!doc || typeof doc.reviewer !== "string" || typeof doc.tables !== "object") {
      errors.push(`${name}: needs reviewer and tables`);
      continue;
    }
    for (const [table, spec] of Object.entries(doc.tables ?? {})) {
      const expected = columnsByTable.get(table);
      if (!expected) {
        errors.push(`${name}: unknown table ${table}`);
        continue;
      }
      const listed = Object.keys(spec.columns ?? {});
      const missing = expected.filter((c) => !listed.includes(c));
      const extra = listed.filter((c) => !expected.includes(c));
      if (missing.length) errors.push(`${name}: ${table} missing columns ${missing.join(", ")}`);
      if (extra.length) errors.push(`${name}: ${table} unknown columns ${extra.join(", ")}`);
      for (const column of listed) {
        const id = `${table}.${column}`;
        const own = spec.columns[column] ?? {};
        for (const key of PER_ITEM)
          if (!meaningful(own[key])) errors.push(`${name}: ${id} needs its own ${key}`);
        const contract = { ...spec.defaults, ...own, reviewer: doc.reviewer };
        for (const key of KEYS)
          if (!meaningful(contract[key])) errors.push(`${name}: ${id} missing ${key}`);
        for (const key of Object.keys(contract))
          if (!KEYS.includes(key)) errors.push(`${name}: ${id} unknown key ${key}`);
        if (out.has(id)) errors.push(`${name}: ${id} defined twice`);
        out.set(id, contract);
      }
    }
    for (const [id, spec] of Object.entries(doc.items ?? {})) {
      const row = byId.get(id);
      if (!row || row.kind === "column") {
        errors.push(`${name}: unknown page/route ${id}`);
        continue;
      }
      const contract = { ...doc.itemDefaults, ...spec, reviewer: doc.reviewer };
      const methods = contract.methods;
      delete contract.methods;
      for (const key of PER_ITEM)
        if (!meaningful(spec[key])) errors.push(`${name}: ${id} needs its own ${key}`);
      for (const key of KEYS)
        if (!meaningful(contract[key])) errors.push(`${name}: ${id} missing ${key}`);
      if (row.kind === "route")
        for (const method of row.source.methods)
          if (!meaningful(methods?.[method]))
            errors.push(`${name}: ${id} missing method ${method}`);
      if (out.has(id)) errors.push(`${name}: ${id} defined twice`);
      out.set(id, row.kind === "route" ? { ...contract, methods } : contract);
    }
  }
  return { errors, contracts: out };
}

function loadFiles() {
  const dir = path.join(root, "field-contracts");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f, doc: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const ledgerPath = path.join(root, "field-dispositions.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const { errors, contracts } = buildContracts(ledger, loadFiles());
  if (errors.length) {
    console.error(errors.slice(0, 40).join("\n"));
    console.error(`${errors.length} contract error(s); ledger not changed`);
    process.exit(1);
  }
  const mode = process.argv[2];
  if (mode === "apply") {
    for (const row of ledger.records) {
      const contract = contracts.get(row.id);
      if (contract) {
        row.status = "reviewed";
        row.contract = contract;
      }
    }
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  } else if (mode === "check") {
    const drift = ledger.records.filter(
      (row) =>
        (contracts.has(row.id) &&
          JSON.stringify(row.contract) !== JSON.stringify(contracts.get(row.id))) ||
        (!contracts.has(row.id) && row.status === "reviewed")
    );
    if (drift.length) {
      console.error(`Ledger differs from field-contracts for ${drift.length} record(s)`);
      process.exit(1);
    }
  } else {
    console.error("Usage: apply-field-contracts.mjs apply|check");
    process.exit(2);
  }
  const reviewed = ledger.records.filter((row) => row.status === "reviewed").length;
  process.stdout.write(
    `${contracts.size} authored contracts; ledger ${reviewed} reviewed / ${ledger.records.length - reviewed} pending\n`
  );
}

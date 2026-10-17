import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("docs/backend-foundation");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const map = read("schema-map.json");
const tables = read("evidence/tables.json");
assert.equal(map.tables.length, 88);
assert.equal(new Set(map.tables.map((x) => x.source)).size, 88);
assert.deepEqual(
  map.tables.map((x) => x.source).sort(),
  tables.map((x) => "public." + x.name).sort()
);
assert.equal(
  map.tables.reduce((n, x) => n + x.currentColumns.length, 0),
  1051
);
assert.equal(read("evidence/page-inventory.json").length, 109);
assert.equal(read("evidence/route-inventory.json").length, 131);
assert.equal(read("job-register.json").jobs.length, 24);
const tasks = read("task-register.json").tasks;
const ids = new Set(tasks.map((x) => x.id));
assert.equal(ids.size, 33);
const visiting = new Set(),
  done = new Set();
const visit = (id) => {
  assert(!visiting.has(id), "cyclic task dependency " + id);
  if (done.has(id)) return;
  visiting.add(id);
  for (const d of tasks.find((t) => t.id === id).dependsOn) {
    assert(ids.has(d), "unknown task " + d);
    visit(d);
  }
  visiting.delete(id);
  done.add(id);
};
tasks.forEach((t) => visit(t.id));
for (const name of fs.readdirSync(root).filter((x) => x.endsWith(".md"))) {
  const text = fs.readFileSync(path.join(root, name), "utf8");
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = m[1];
    if (/^[a-z]+:|^#/.test(link)) continue;
    assert(fs.existsSync(path.resolve(root, link.split("#")[0])), `${name}: broken link ${link}`);
  }
}
if (fs.existsSync(path.join(root, "validation-results.json"))) {
  const validation = read("validation-results.json");
  validation.packIntegrity.status = "PASS";
  validation.packIntegrity.checkedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(root, "validation-results.json"),
    JSON.stringify(validation, null, 2) + "\n"
  );
}
console.log(
  "Planning pack: 88 table/1051 column mappings, 109 pages, 131 routes, 24 jobs, 33 unique acyclic tasks, and local Markdown links verified. Runtime/field semantics remain subject to the implementation gates."
);

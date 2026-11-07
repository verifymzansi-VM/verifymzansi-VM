import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Documents that describe the retired source backend. Each must open with the
// label so a person or agent reading it does not mistake it for the live
// foundation backend. Remove a path only when the document is rewritten for
// foundation or deleted.
const HISTORICAL_DOCS = [
  "docs/ARCHITECTURE.md",
  "docs/admin-access-inventory.md",
  "docs/business-verification-spec.md",
  "docs/mobile-app-agent-build-brief.md",
  "docs/mobile-app-build-spec.md",
  "docs/ozow-payment-repair-rollout.md",
  "docs/runbooks/admin-provisioning.md",
  "docs/supabase-schema-sync.md",
];
const LABEL = "Historical: describes the retired source backend";

function firstLine(text) {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== "") ?? "";
  return line.replace(/^[>\s*_]+/, "");
}

test("documents about the retired backend open with the Historical label", () => {
  for (const path of HISTORICAL_DOCS) {
    assert.ok(
      firstLine(readFileSync(path, "utf8")).startsWith(LABEL),
      `${path} must start with "${LABEL}"`
    );
  }
});

test("the README describes the automatic release, not a manual one", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.equal(readme.includes("Pushing\n`main` runs CI only"), false);
  assert.equal(readme.includes("Pushing `main` runs CI only"), false);
  assert.equal(/push to `master`/.test(readme), false);
  assert.match(readme, /Merging a pull request into `main` releases it/);
});

test("AGENTS.md states the live backend, database changes and release rule", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  for (const heading of [
    "## The live backend",
    "## Database changes",
    "## Releasing",
    "## Changing the frontend (owner's standing rules)",
    "## Glossary",
  ]) {
    assert.ok(agents.includes(heading), `AGENTS.md needs "${heading}"`);
  }
  assert.match(agents, /database\/foundation\/updates\//);
  assert.match(agents, /A merge into `main` is a production release/);
  assert.match(agents, /<!-- BEGIN:nextjs-agent-rules -->/);
});

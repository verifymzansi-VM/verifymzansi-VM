import assert from "node:assert/strict";
import { test } from "node:test";
import { brokenDocLinks, checkRepositoryDocLinks, linkTargets } from "./lib/doc-links.mjs";

test("link targets come from inline and reference links, not code", () => {
  const markdown = [
    "See [guide](docs/guide.md) and ![logo](public/logo.png).",
    "[ref]: docs/ref.md",
    "`[not](docs/inline-code.md)`",
    "```",
    "[not](docs/fenced.md)",
    "```",
  ].join("\n");
  assert.deepEqual(linkTargets(markdown), ["docs/guide.md", "public/logo.png", "docs/ref.md"]);
});

test("relative, root and anchored links must reach a tracked file or folder", () => {
  const files = ["README.md", "docs/RUNBOOK.md", "docs/guide.md", "scripts/tool.mjs"];
  const text = {
    "README.md":
      "[ok](docs/guide.md#top) [dir](scripts/) [web](https://example.com) [anchor](#here) [gone](docs/missing.md)",
    "docs/RUNBOOK.md": "[ok](guide.md) [root](/scripts/tool.mjs) [wrong base](docs/guide.md)",
    "docs/guide.md": "[up](../README.md)",
  };
  assert.deepEqual(
    brokenDocLinks(files, (file) => text[file]),
    [
      { file: "README.md", target: "docs/missing.md" },
      { file: "docs/RUNBOOK.md", target: "docs/guide.md" },
    ]
  );
});

test("tracked documents have no broken relative links", () => {
  assert.deepEqual(checkRepositoryDocLinks(), []);
});

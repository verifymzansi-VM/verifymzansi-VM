import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A business fact still waiting for the owner is written as an owner
// placeholder while a change is drafted; none may reach a page or an email.
const MARKER = "[[" + "OWNER:";
const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|json)$/.test(entry.name) ? [full] : [];
  });
}

describe("owner placeholders", () => {
  it("none is left in the website source", () => {
    const left = sourceFiles(ROOT).filter((file) => readFileSync(file, "utf8").includes(MARKER));
    expect(left.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});

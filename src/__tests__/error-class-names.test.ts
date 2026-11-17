/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * Server logs name an error by its `name` (see errorTypeOf). Production builds
 * minify class names, so every server error class must set its own name:
 * `override name = "<ClassName>"` (or `this.name = "<ClassName>"`).
 */

const ROOTS = ["src/lib", "src/app", "workers"];
const DECLARATION = /^[ \t]*(?:export\s+)?class\s+(\w+)\s+extends\s+(\w+)\b[^{]*\{/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory())
      return entry === "node_modules" || entry === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) ? [path] : [];
  });
}

function classBody(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(open, index + 1);
  }
  return source.slice(open);
}

function errorClassesWithoutOwnName(): string[] {
  const missing: string[] = [];
  for (const file of ROOTS.flatMap(sourceFiles)) {
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use client["']/.test(source)) continue;
    for (const match of source.matchAll(DECLARATION)) {
      const [declaration, name, base] = match;
      if (base !== "Error" && !base.endsWith("Error")) continue;
      const body = classBody(source, match.index + declaration.length - 1);
      const ownName = new RegExp(
        `(?:override\\s+(?:readonly\\s+)?name|readonly\\s+name|this\\.name)\\s*=\\s*["'\`]${name}["'\`]`
      );
      if (!ownName.test(body)) missing.push(`${relative(process.cwd(), file)}: ${name}`);
    }
  }
  return missing;
}

it("gives every server error class a stable name that survives minification", () => {
  expect(errorClassesWithoutOwnName()).toEqual([]);
});

it("finds error classes (guards against the scan silently matching nothing)", () => {
  const source = readFileSync("src/lib/foundation/request-api.ts", "utf8");
  expect([...source.matchAll(DECLARATION)].map((match) => match[1])).toContain(
    "FoundationSessionError"
  );
});

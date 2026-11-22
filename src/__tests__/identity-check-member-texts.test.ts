/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IDENTITY_CHECK_FRAME_ORIGIN,
  isIdentityCheckFrameMessage,
} from "@/lib/verification/identity-check-frame";

const root = join(__dirname, "..");
/** Staff screens and server code may name the partner; member pages, help
 * and shared components may not (Didit plan, appendix D). */
const memberSources = [join(root, "app"), join(root, "components")];
const staffOrServer = [
  join(root, "app", "admin"),
  join(root, "app", "api"),
  join(root, "components", "admin"),
];

function files(dir: string): string[] {
  if (staffOrServer.includes(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|mdx?|json)$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("automatic ID checks, member side", () => {
  it("never names the provider in member pages, help or shared components", () => {
    const sources = memberSources.flatMap(files);
    expect(sources.some((path) => path.includes(`${sep}help${sep}verification`))).toBe(true);
    const naming = sources
      .filter((path) => /didit/i.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(naming).toEqual([]);
  });

  it("accepts frame messages only from the check's own origin", () => {
    expect(isIdentityCheckFrameMessage({ origin: IDENTITY_CHECK_FRAME_ORIGIN })).toBe(true);
    for (const origin of [
      "https://verify.didit.me.evil.example",
      "http://verify.didit.me",
      "https://verifymzansi.com",
      "null",
      "",
    ])
      expect(isIdentityCheckFrameMessage({ origin })).toBe(false);
  });
});

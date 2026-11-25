/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IDENTITY_CHECK_FRAME_ORIGIN,
  isIdentityCheckFrameMessage,
} from "@/lib/verification/identity-check-frame";
import {
  DIDIT_END_USER_TERMS_URL,
  DIDIT_PRIVACY_NOTICE_URL,
} from "@/lib/verification/identity-check-consent";

const root = join(__dirname, "..");
/**
 * Staff screens and server code may name the partner. Member pages, help and
 * shared components name it only on the consent step, with links to its two
 * notices (owner decision L, 20 Nov 2026, which replaced "never name the
 * provider" of the Didit plan, appendix D).
 */
const CONSENT_STEP = join("app", "verification", "independent-check.tsx");
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
  it("names the provider only on the consent step of member pages, help and shared components", () => {
    const sources = memberSources.flatMap(files);
    expect(sources.some((path) => path.includes(`${sep}help${sep}verification`))).toBe(true);
    const naming = sources
      .filter((path) => /didit/i.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(naming).toEqual([CONSENT_STEP]);
  });

  it("names the provider on the consent step with links to its two notices", () => {
    const consent = readFileSync(join(root, CONSENT_STEP), "utf8");
    expect(consent).toMatch(/VerifyMzansi asks Didit, our independent verification partner/);
    expect(consent).toContain("DIDIT_PRIVACY_NOTICE_URL");
    expect(consent).toContain("DIDIT_END_USER_TERMS_URL");
    expect(DIDIT_PRIVACY_NOTICE_URL).toBe("https://didit.me/terms/verification-privacy-notice");
    expect(DIDIT_END_USER_TERMS_URL).toBe("https://didit.me/terms/identity-verification");
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

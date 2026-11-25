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
 * provider" of the Didit plan, appendix D), and on the two legal pages that
 * must name every provider: the Privacy Policy and the PAIA manual (POPIA
 * section 18 and settled legal answers D3 and D4).
 */
const CONSENT_STEP = join("app", "verification", "independent-check.tsx");
const LEGAL_PAGES = [join("app", "privacy", "page.tsx"), join("app", "paia", "page.tsx")];
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
  it("names the provider only on the consent step and the legal pages of member pages, help and shared components", () => {
    const sources = memberSources.flatMap(files);
    expect(sources.some((path) => path.includes(`${sep}help${sep}verification`))).toBe(true);
    const naming = sources
      .filter((path) => /didit/i.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(naming.sort()).toEqual([CONSENT_STEP, ...LEGAL_PAGES].sort());
  });

  it("names the provider on the consent step with links to its two notices", () => {
    const consent = readFileSync(join(root, CONSENT_STEP), "utf8");
    expect(consent).toMatch(/VerifyMzansi asks Didit, our independent verification partner/);
    // Where Didit handles the data, as the Privacy Policy's Didit entry says
    // (settled legal answer D3: every country named at the ID consent step).
    expect(consent.replace(/\s+/g, " ")).toContain(
      "with my data held in Ireland (European Union) and some of Didit&apos;s providers in the United States"
    );
    expect(consent).toContain("DIDIT_PRIVACY_NOTICE_URL");
    expect(consent).toContain("DIDIT_END_USER_TERMS_URL");
    expect(DIDIT_PRIVACY_NOTICE_URL).toBe("https://didit.me/terms/verification-privacy-notice");
    expect(DIDIT_END_USER_TERMS_URL).toBe("https://didit.me/terms/identity-verification");
  });

  it("states the keep-for rules the database applies on the privacy panel", () => {
    // 20261122022323_identity_keep_for.sql: the selfie and ID number go 90 days
    // after a good-standing closure; names, phones and the one-way code stay 5 years.
    const panel = readFileSync(join(root, "app", "verification", "verification-ui.tsx"), "utf8");
    expect(panel).toContain(
      "Once verified: selfie and ID number kept until 90 days after you close your account; names, phone and a one-way code for 5 years"
    );
    expect(panel).not.toContain("selfie, ID number, names and phone kept until 5 years");
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

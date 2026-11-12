import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFoundationPostingTerms } = vi.hoisted(() => ({
  readFoundationPostingTerms: vi.fn(),
}));
vi.mock("@/lib/foundation/posting-terms", () => ({ readFoundationPostingTerms }));
vi.mock("@/lib/foundation/public-api", () => ({ createFoundationPublicApi: () => ({}) }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));

import { isPostingTermsVersionAwaitingForce } from "./current-posting-terms";

const current = (version: string) => ({
  version,
  document_hash: "A".repeat(43),
  document_path: `/terms/versions/${version}`,
});
const PUBLISHED = ["posting-v1", "posting-v2", "posting-v3", "posting-v4"];
async function awaiting() {
  const result: string[] = [];
  for (const version of PUBLISHED)
    if (await isPostingTermsVersionAwaitingForce(version)) result.push(version);
  return result;
}

describe("whether a published posting terms version is in force yet", () => {
  beforeEach(() => {
    readFoundationPostingTerms.mockReset();
    vi.stubEnv("FOUNDATION_SUPABASE_URL", "https://foundation.example.test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("follows the database: versions after its current one are not in force yet", async () => {
    readFoundationPostingTerms.mockResolvedValue(current("posting-v3"));
    await expect(awaiting()).resolves.toEqual(["posting-v4"]);
  });

  it("takes effect as soon as the database makes the new version current", async () => {
    readFoundationPostingTerms.mockResolvedValue(current("posting-v4"));
    await expect(awaiting()).resolves.toEqual([]);
  });

  it("counts the newest and any later version as not in force when the database cannot be read", async () => {
    readFoundationPostingTerms.mockRejectedValue(new Error("unavailable"));
    await expect(awaiting()).resolves.toEqual(["posting-v4"]);
    readFoundationPostingTerms.mockResolvedValue(null);
    await expect(awaiting()).resolves.toEqual(["posting-v4"]);
    // A current version this release does not know is treated the same way.
    readFoundationPostingTerms.mockResolvedValue(current("posting-v9"));
    await expect(awaiting()).resolves.toEqual(["posting-v4"]);
    vi.stubEnv("FOUNDATION_SUPABASE_URL", "");
    await expect(awaiting()).resolves.toEqual(["posting-v4"]);
  });

  it("is false for a version this release does not publish", async () => {
    readFoundationPostingTerms.mockResolvedValue(current("posting-v3"));
    await expect(isPostingTermsVersionAwaitingForce("posting-v5")).resolves.toBe(false);
  });
});

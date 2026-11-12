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

describe("a posting terms version published ahead of time", () => {
  beforeEach(() => {
    readFoundationPostingTerms.mockReset();
    vi.stubEnv("FOUNDATION_SUPABASE_URL", "https://foundation.example.test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("waits while the database keeps the earlier version current", async () => {
    readFoundationPostingTerms.mockResolvedValue(current("posting-v3"));
    await expect(isPostingTermsVersionAwaitingForce("posting-v4")).resolves.toBe(true);
  });

  it("is in force as soon as the database makes it current", async () => {
    readFoundationPostingTerms.mockResolvedValue(current("posting-v4"));
    await expect(isPostingTermsVersionAwaitingForce("posting-v4")).resolves.toBe(false);
  });

  it("counts as not in force when the current version cannot be read", async () => {
    readFoundationPostingTerms.mockRejectedValue(new Error("unavailable"));
    await expect(isPostingTermsVersionAwaitingForce("posting-v4")).resolves.toBe(true);
    readFoundationPostingTerms.mockResolvedValue(null);
    await expect(isPostingTermsVersionAwaitingForce("posting-v4")).resolves.toBe(true);
    vi.stubEnv("FOUNDATION_SUPABASE_URL", "");
    await expect(isPostingTermsVersionAwaitingForce("posting-v4")).resolves.toBe(true);
  });

  it("never applies to the active or earlier versions, which need no database read", async () => {
    for (const version of ["posting-v1", "posting-v2", "posting-v3", "unpublished"])
      await expect(isPostingTermsVersionAwaitingForce(version)).resolves.toBe(false);
    expect(readFoundationPostingTerms).not.toHaveBeenCalled();
  });
});

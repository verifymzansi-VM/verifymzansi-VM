import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSelfReviewCaller, readMyFrontendDecisions } = vi.hoisted(() => ({
  readSelfReviewCaller: vi.fn(),
  readMyFrontendDecisions: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/self-review-session", () => ({ readSelfReviewCaller }));
vi.mock("@/lib/foundation/member-appeals", () => ({ readMyFrontendDecisions }));

import { getMemberDecisions } from "./member-decisions";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const api = { rpc: vi.fn() };

describe("getMemberDecisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSelfReviewCaller.mockResolvedValue({ api, accountId: ACCOUNT });
  });

  it("reads the member's own decisions from the foundation", async () => {
    readMyFrontendDecisions.mockResolvedValue([{ decisionId: "d-1" }]);
    await expect(getMemberDecisions(ACCOUNT)).resolves.toEqual([{ decisionId: "d-1" }]);
    expect(readMyFrontendDecisions).toHaveBeenCalledExactlyOnceWith(api, ACCOUNT);
  });

  it("refuses when the signed-in account is not the one asked for", async () => {
    await expect(getMemberDecisions("22222222-2222-4222-8222-222222222222")).rejects.toThrow(
      "Current account changed"
    );
    expect(readMyFrontendDecisions).not.toHaveBeenCalled();
  });
});

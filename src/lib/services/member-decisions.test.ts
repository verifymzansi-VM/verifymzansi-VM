import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoundationSessionError } from "@/lib/foundation/request-api";

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

  it("reads the signed-in member's own decisions from the foundation", async () => {
    readMyFrontendDecisions.mockResolvedValue([{ decisionId: "d-1" }]);
    await expect(getMemberDecisions()).resolves.toEqual([{ decisionId: "d-1" }]);
    expect(readMyFrontendDecisions).toHaveBeenCalledExactlyOnceWith(api, ACCOUNT);
  });

  it("answers null when nobody is signed in", async () => {
    readSelfReviewCaller.mockRejectedValue(new FoundationSessionError(401));
    await expect(getMemberDecisions()).resolves.toBeNull();
    expect(readMyFrontendDecisions).not.toHaveBeenCalled();
  });

  it("passes on an unavailable session check", async () => {
    readSelfReviewCaller.mockRejectedValue(new FoundationSessionError(503));
    await expect(getMemberDecisions()).rejects.toBeInstanceOf(FoundationSessionError);
    expect(readMyFrontendDecisions).not.toHaveBeenCalled();
  });
});

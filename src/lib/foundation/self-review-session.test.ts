import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { readSelfReviewCaller, readSelfReviewSession } from "./self-review-session";
import { readFoundationRequestCaller, FoundationSessionError } from "./request-api";
import { readMyRestrictionStatus } from "./enforcement";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => connection }));
vi.mock("./request-api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationRequestCaller: vi.fn(),
}));
vi.mock("./enforcement", () => ({ readMyRestrictionStatus: vi.fn() }));

const connection = { marker: "connection" };
const account = "00000000-0000-4000-8000-000000000001";
const api = { marker: "api" };
const jar = [{ name: "sb-project-auth-token", value: "token" }];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ getAll: () => jar } as never);
  vi.mocked(readFoundationRequestCaller).mockResolvedValue({ accountId: account, api } as never);
});

describe("readSelfReviewCaller", () => {
  it("verifies the caller from the request cookies against the foundation project", async () => {
    await expect(readSelfReviewCaller()).resolves.toEqual({ accountId: account, api });
    const [input, store] = vi.mocked(readFoundationRequestCaller).mock.calls[0]!;
    expect(input).toBe(connection);
    expect(await store.getAll()).toEqual(jar);
  });
});

describe("readSelfReviewSession", () => {
  it("reads the restriction status of the verified caller only", async () => {
    vi.mocked(readMyRestrictionStatus).mockResolvedValueOnce({
      account_id: account,
      status: "banned",
      ends_at: null,
    });
    await expect(readSelfReviewSession()).resolves.toMatchObject({ status: "banned" });
    expect(readMyRestrictionStatus).toHaveBeenCalledWith(api, account);
  });

  it("does not read a status without a verified session", async () => {
    vi.mocked(readFoundationRequestCaller).mockRejectedValueOnce(new FoundationSessionError(401));
    await expect(readSelfReviewSession()).rejects.toBeInstanceOf(FoundationSessionError);
    expect(readMyRestrictionStatus).not.toHaveBeenCalled();
  });
});

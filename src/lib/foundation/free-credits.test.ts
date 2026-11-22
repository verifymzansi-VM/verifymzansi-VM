/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { readFreeCredits } from "./free-credits";
import { FoundationStaffCommandError } from "./staff-command";

const ID = "6f1d3c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f";
const row = {
  id: ID,
  member: "t***@example.co.za",
  posts: 2,
  starts_at: "2026-11-22T08:00:00.123+00:00",
  ends_at: "2026-12-22T08:00:00.123+00:00",
  status: "active",
  views: 42,
};
const apiWith = (answer: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(answer);
  return { api: { rpc } as unknown as Parameters<typeof readFreeCredits>[0], rpc };
};

describe("readFreeCredits", () => {
  it("reads api.list_free_credits into the screen's rows", async () => {
    const { api, rpc } = apiWith({ data: { items: [row, { ...row, member: null }] }, error: null });
    await expect(readFreeCredits(api)).resolves.toEqual([
      {
        id: ID,
        member: "t***@example.co.za",
        posts: 2,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: "active",
        views: 42,
      },
      expect.objectContaining({ member: null }),
    ]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_free_credits", {}, { get: false });
  });

  it("refuses an answer it does not expect", async () => {
    for (const data of [
      { items: [{ ...row, posts: 7 }] },
      { items: [{ ...row, reason: "a staff note" }] },
      { items: [{ ...row, status: "revoked" }] },
      null,
    ])
      await expect(readFreeCredits(apiWith({ data, error: null }).api)).rejects.toThrow(
        "could not be confirmed"
      );
  });

  it("asks staff to verify again on an expired authenticator code", async () => {
    const thrown = await readFreeCredits(
      apiWith({
        data: null,
        error: { code: "42501", message: "staff second-factor verification expired" },
      }).api
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(FoundationStaffCommandError);
    expect((thrown as FoundationStaffCommandError).mfaRequired).toBe(true);
  });
});

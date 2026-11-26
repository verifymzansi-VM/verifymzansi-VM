import { describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readStaffVideoLengths } from "./staff-video-lengths";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (n: number) => `media/${uuid(500 + n)}`;
const apiWith = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc }) as unknown as FoundationAuthenticatedApi;

describe("readStaffVideoLengths", () => {
  it("asks nothing when the reviewer holds no post with a video", async () => {
    const rpc = vi.fn();
    await expect(readStaffVideoLengths(apiWith(rpc), [])).resolves.toEqual(new Map());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives whole seconds per post in media order, and null when not recorded", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { post_id: uuid(1), object_key: key(1), duration_ms: 95_999 },
        { post_id: uuid(2), object_key: key(2), duration_ms: null },
        { post_id: uuid(2), object_key: key(3), duration_ms: 1 },
        { post_id: uuid(9), object_key: key(4), duration_ms: 1000 },
      ],
      error: null,
    });
    const lengths = await readStaffVideoLengths(apiWith(rpc), [uuid(1), uuid(2)]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_frontend_staff_video_lengths",
      { p_posts: [uuid(1), uuid(2)] },
      { get: false }
    );
    expect(lengths).toEqual(
      new Map([
        [uuid(1), [{ seconds: 95 }]],
        [uuid(2), [{ seconds: null }, { seconds: 0 }]],
      ])
    );
  });

  it.each([
    ["a refused read", { data: null, error: { code: "42501" } }],
    ["an unexpected shape", { data: [{ post_id: uuid(1), duration_ms: 1000 }], error: null }],
    [
      "a length over the limit",
      {
        data: [{ post_id: uuid(1), object_key: key(1), duration_ms: 121_000 }],
        error: null,
      },
    ],
  ])("leaves the lengths out after %s", async (_case, answer) => {
    const rpc = vi.fn().mockResolvedValue(answer);
    await expect(readStaffVideoLengths(apiWith(rpc), [uuid(1)])).resolves.toEqual(new Map());
  });
});

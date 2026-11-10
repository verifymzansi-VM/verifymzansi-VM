import { beforeEach, expect, it, vi } from "vitest";
import { readRestoredOwnerDashboard } from "./owner-dashboard-server";
import { readFoundationServerSession } from "./server-session";
import { readFoundationOwnerDashboard, dashboardPosts } from "./owner-dashboard";
import { readRestoredOwnerPost } from "./restored-owner-posts";

vi.mock("./server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("./owner-dashboard", () => ({
  readFoundationOwnerDashboard: vi.fn(),
  presentedDashboardProfile: vi.fn(() => ({})),
  dashboardVerificationSteps: vi.fn(() => []),
  dashboardPosts: vi.fn(),
}));
vi.mock("./restored-owner-posts", () => ({ readRestoredOwnerPost: vi.fn() }));

const api = { rpc: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFoundationServerSession).mockResolvedValue({
    user: { id: "owner" },
    account: {},
    api,
  } as unknown as Awaited<ReturnType<typeof readFoundationServerSession>>);
  vi.mocked(readFoundationOwnerDashboard).mockResolvedValue(
    {} as Awaited<ReturnType<typeof readFoundationOwnerDashboard>>
  );
});

it("reads the deletion date only for ended posts and tolerates a failed read", async () => {
  vi.mocked(dashboardPosts).mockReturnValue([
    { id: "live", status: "live" },
    { id: "sold", status: "sold" },
    { id: "expired", status: "expired" },
  ] as unknown as ReturnType<typeof dashboardPosts>);
  vi.mocked(readRestoredOwnerPost).mockImplementation(async (_api, id) => {
    if (id === "expired") throw new Error("Your post could not be loaded");
    return { deletes_at: "2026-11-12T08:00:00.000Z" } as Awaited<
      ReturnType<typeof readRestoredOwnerPost>
    >;
  });
  const { posts } = await readRestoredOwnerDashboard("owner");
  expect(posts.map((post) => [post.id, post.deletes_at])).toEqual([
    ["live", null],
    ["sold", "2026-11-12T08:00:00.000Z"],
    ["expired", null],
  ]);
  expect(vi.mocked(readRestoredOwnerPost).mock.calls.map(([, id]) => id)).toEqual([
    "sold",
    "expired",
  ]);
  expect(vi.mocked(readRestoredOwnerPost).mock.calls[0][0]).toBe(api);
});
it("gives the trial card the member's running free week, and nothing when it cannot be read", async () => {
  vi.mocked(dashboardPosts).mockReturnValue([]);
  api.rpc.mockResolvedValueOnce({
    data: {
      status: "running",
      starts_at: "2026-11-10T08:00:00+00:00",
      ends_at: "2026-11-17T08:00:00+00:00",
    },
    error: null,
  });
  const { introTrial } = await readRestoredOwnerDashboard("owner");
  expect(api.rpc).toHaveBeenCalledWith("get_my_intro_trial", {}, { get: false });
  expect(introTrial).toMatchObject({
    duration_days: 7,
    activated_at: "2026-11-10T08:00:00+00:00",
    expires_at: "2026-11-17T08:00:00+00:00",
  });
  api.rpc.mockResolvedValueOnce({ data: null, error: { code: "42883" } });
  expect((await readRestoredOwnerDashboard("owner")).introTrial).toBeNull();
});

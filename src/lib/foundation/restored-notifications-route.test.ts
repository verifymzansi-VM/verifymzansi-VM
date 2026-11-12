/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleRestoredNotifications } from "./restored-notifications-route";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationAccountContext } from "./account-context";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("./account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: vi.fn(),
}));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  rpc = vi.fn();
const notice = {
  id,
  kind: "account_warning",
  post_id: null,
  post_title: null,
  organisation_name: null,
  organisation_slug: null,
  created_at: "2026-11-05T04:00:00Z",
  read_at: null,
  warning_reason: "The actual staff warning reason for this account.",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(readFoundationAccountContext).mockResolvedValue({ account_id: owner } as Awaited<
    ReturnType<typeof readFoundationAccountContext>
  >);
  rpc.mockResolvedValue({ data: { items: [notice], unread_count: 1 }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("presents the exact owner warning through the selected notification interface", async () => {
  const response = await handleRestoredNotifications(
    new NextRequest("https://verifymzansi.com/api/notifications"),
    "GET"
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    accountId: owner,
    unreadCount: 1,
    notifications: [
      {
        id,
        title: "Account warning",
        message: notice.warning_reason,
        href: "/dashboard",
        type: "warning",
        read: false,
        created_at: notice.created_at,
      },
    ],
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("list_my_frontend_notices", {
    p_limit: 25,
    p_unread: false,
  });
});
it("refuses a warning without its real reason instead of fabricating a notice", async () => {
  rpc.mockResolvedValueOnce({
    data: { items: [{ ...notice, warning_reason: null }], unread_count: 1 },
    error: null,
  });
  expect(
    (
      await handleRestoredNotifications(
        new NextRequest("https://verifymzansi.com/api/notifications"),
        "GET"
      )
    ).status
  ).toBe(503);
});
it("points a member whose ID was sent back to the verification page, without the reason", async () => {
  rpc.mockResolvedValueOnce({
    data: {
      items: [{ ...notice, kind: "verification_returned", warning_reason: null }],
      unread_count: 1,
    },
    error: null,
  });
  const response = await handleRestoredNotifications(
    new NextRequest("https://verifymzansi.com/api/notifications"),
    "GET"
  );
  expect(response.status).toBe(200);
  expect((await response.json()).notifications).toEqual([
    {
      id,
      title: "Your ID check needs another look",
      message: "Your ID was sent back. Open verification to see why and what to do next.",
      href: "/verification",
      type: "warning",
      read: false,
      created_at: notice.created_at,
    },
  ]);
});

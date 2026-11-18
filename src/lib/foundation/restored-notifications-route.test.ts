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
it("tells a member their ID check was accepted and links verification", async () => {
  rpc.mockResolvedValueOnce({
    data: {
      items: [{ ...notice, kind: "identity_accepted", warning_reason: null }],
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
      title: "Your ID check was accepted",
      message: "Your identity is verified. Open verification to see any steps that remain.",
      href: "/verification",
      type: "success",
      read: false,
      created_at: notice.created_at,
    },
  ]);
});
it("names the post in moderation notices, with a fallback when the title is gone", async () => {
  const post = "33333333-3333-4333-8333-333333333333";
  rpc.mockResolvedValueOnce({
    data: {
      items: [
        {
          ...notice,
          kind: "post_approved",
          warning_reason: null,
          post_id: post,
          post_title: "Red bicycle",
        },
        { ...notice, kind: "post_rejected", warning_reason: null, post_id: post, post_title: null },
        {
          ...notice,
          kind: "post_changes_rejected",
          warning_reason: null,
          post_id: post,
          post_title: " Sofa ",
        },
      ],
      unread_count: 3,
    },
    error: null,
  });
  const response = await handleRestoredNotifications(
    new NextRequest("https://verifymzansi.com/api/notifications"),
    "GET"
  );
  const body = await response.json();
  expect(
    body.notifications.map((n: { title: string; message: string; href: string; type: string }) => [
      n.title,
      n.message,
      n.href,
      n.type,
    ])
  ).toEqual([
    [
      "Your post is live",
      "“Red bicycle” was approved and is now live.",
      "/dashboard/listings",
      "success",
    ],
    [
      "Post not approved",
      "Your post was not approved. Open your posts to see why and what to change.",
      "/dashboard/listings",
      "warning",
    ],
    [
      "Changes not approved",
      "Your changes to “Sofa” were not approved. Open your posts to see why.",
      "/dashboard/listings",
      "warning",
    ],
  ]);
});
it("links payment notices to My slots and says what was emailed", async () => {
  rpc.mockResolvedValueOnce({
    data: {
      items: [{ ...notice, kind: "payment_completed", warning_reason: null }],
      unread_count: 1,
    },
    error: null,
  });
  const response = await handleRestoredNotifications(
    new NextRequest("https://verifymzansi.com/api/notifications"),
    "GET"
  );
  expect((await response.json()).notifications[0]).toMatchObject({
    title: "Payment received",
    message: "We received your payment. Your receipt and invoice were emailed to you.",
    href: "/dashboard/slots",
    type: "success",
  });
});
it("presents every account event kind the database adds", async () => {
  const kinds = [
    "verification_phone_confirmed",
    "payment_completed",
    "payment_reversed",
    "payment_reconciliation_required",
    "trial_started",
    "post_changes_approved",
    "invoice_issued",
    "content_restored",
    "post_expired",
    "post_sold",
    "post_kept",
    "draft_deletion_warning",
    "post_deleted",
    "slot_renewal_reminder",
    // 20261118072601_staff_data_minimisation.sql
    "privacy_request_approved",
    "privacy_export_made",
  ];
  rpc.mockResolvedValueOnce({
    data: {
      items: kinds.map((kind) => ({ ...notice, kind, warning_reason: null })),
      unread_count: kinds.length,
    },
    error: null,
  });
  const response = await handleRestoredNotifications(
    new NextRequest("https://verifymzansi.com/api/notifications"),
    "GET"
  );
  expect(response.status).toBe(200);
  const presented = (await response.json()).notifications as { title: string; href: string }[];
  expect(presented).toHaveLength(kinds.length);
  for (const n of presented) {
    expect(n.title.length).toBeGreaterThan(0);
    expect(n.href).toMatch(/^\/[a-z]/);
  }
});
it("leaves out a notice of a kind this release does not know instead of failing the bell", async () => {
  rpc.mockResolvedValueOnce({
    data: {
      items: [
        { ...notice, id: "44444444-4444-4444-8444-444444444444", kind: "some_future_kind" },
        notice,
      ],
      unread_count: 2,
    },
    error: null,
  });
  const response = await handleRestoredNotifications(
    new NextRequest("https://verifymzansi.com/api/notifications"),
    "GET"
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.notifications.map((n: { id: string }) => n.id)).toEqual([id]);
  // The badge counts only what the list shows.
  expect(body.unreadCount).toBe(1);
});

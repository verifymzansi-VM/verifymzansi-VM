/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET, PATCH, DELETE } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationAccountContext } from "@/lib/foundation/account-context";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createClient } from "@/lib/supabase/server";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
const owner = "11111111-1111-4111-8111-111111111111",
  id = "aaaaaaaa-aaaa-4aaa-8aaa-111111111111",
  csrf = "c".repeat(64);
const rpc = vi.fn();
function request(method = "GET", body?: unknown, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/notifications?limit=25", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (r: NextResponse) => {
      r.headers.set("cache-control", "private, no-store");
      return r;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(readFoundationAccountContext).mockResolvedValue({ account_id: owner } as Awaited<
    ReturnType<typeof readFoundationAccountContext>
  >);
  rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "mark_my_notifications_read"
        ? { marked: 1, unread_count: 0 }
        : name === "dismiss_my_notifications"
          ? { dismissed: 1, unread_count: 0 }
          : {
              items: [
                {
                  id,
                  kind: "enquiry_received",
                  post_id: null,
                  post_title: null,
                  organisation_name: null,
                  organisation_slug: null,
                  created_at: "2026-11-04T00:00:00Z",
                  read_at: null,
                },
              ],
              unread_count: 1,
            },
  }));
});
afterEach(() => vi.unstubAllEnvs());
it("maps native events into the existing bell contract without source table access", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    accountId: owner,
    unreadCount: 1,
    notifications: [{ id, title: "New enquiry", href: "/dashboard/leads", read: false }],
  });
  expect(createClient).not.toHaveBeenCalled();
});
it("marks one or all owned notifications using the native command", async () => {
  expect((await PATCH(request("PATCH", { id }))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith("mark_my_notifications_read", { p_ids: [id] });
  expect((await PATCH(request("PATCH", { all: true }))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith("mark_my_notifications_read", {});
});
it("uses dismissal rather than deleting delivery records", async () => {
  expect((await DELETE(request("DELETE", { id }))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith("dismiss_my_notifications", { p_ids: [id] });
});
it("preserves CSRF, refuses claimed ownership and fails closed on degraded protection", async () => {
  expect((await DELETE(request("DELETE", { id }, false))).status).toBe(403);
  expect((await PATCH(request("PATCH", { id, owner_id: owner }))).status).toBe(400);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, degraded: true });
  expect((await GET(request())).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

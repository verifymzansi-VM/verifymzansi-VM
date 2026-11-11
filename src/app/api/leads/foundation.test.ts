/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET, PATCH } from "./route";
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
  post = "bbbbbbbb-bbbb-4bbb-8bbb-111111111111",
  at = "2026-11-03T12:00:00Z",
  csrf = "c".repeat(64);
const rpc = vi.fn();
function request(path = "", body?: unknown, validCsrf = true) {
  return new NextRequest(
    "https://verifymzansi.com/api/leads" + path,
    body === undefined
      ? {}
      : {
          method: "PATCH",
          body: JSON.stringify(body),
          headers: {
            origin: "https://verifymzansi.com",
            "content-type": "application/json",
            cookie: `vm_csrf=${csrf}`,
            ...(validCsrf ? { "x-csrf-token": csrf } : {}),
          },
        }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(readFoundationAccountContext).mockResolvedValue({ account_id: owner } as Awaited<
    ReturnType<typeof readFoundationAccountContext>
  >);
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_my_inbox_counts")
      return { data: { unread_enquiries: 2, unread_notifications: 1 }, error: null };
    if (name === "set_enquiry_status")
      return { data: { id, status: "read", updated_at: at }, error: null };
    return {
      data: {
        items: [
          {
            id,
            post_id: post,
            post_kind: "event",
            post_area: "tourism_events",
            post_title: "Local event",
            buyer_name: "Buyer",
            buyer_email: "buyer@example.invalid",
            buyer_phone: null,
            email_confirmed: true,
            message: "Please send more details",
            status: "new",
            created_at: at,
            updated_at: at,
          },
        ],
        unread_count: 2,
        next_cursor: null,
      },
      error: null,
    };
  });
});
afterEach(() => vi.unstubAllEnvs());
it("returns owned native enquiries in the existing card contract", async () => {
  const r = await GET(request("?limit=50&unread=true"));
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    accountId: owner,
    unreadCount: 2,
    leads: [
      {
        id,
        target_id: post,
        target_type: "promotion",
        email_confirmed: true,
        listings: { title: "Local event" },
      },
    ],
  });
  expect(rpc).toHaveBeenCalledWith("list_my_frontend_enquiries", { p_limit: 50, p_status: "new" });
  expect(createClient).not.toHaveBeenCalled();
  expect(checkRateLimit).toHaveBeenCalledWith({
    key: "fixture",
    action: "inbox:read",
    degradedMode: "block",
  });
});
it("uses the count RPC without loading buyer data for badges", async () => {
  const r = await GET(request("?countOnly=true"));
  expect(await r.json()).toEqual({ accountId: owner, unreadCount: 2, leads: [] });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("get_my_inbox_counts");
});
it("changes status through the native owner command and keeps foreign/missing rows indistinguishable", async () => {
  expect((await PATCH(request("", { id, status: "read" }))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith("set_enquiry_status", { p_id: id, p_status: "read" });
  rpc.mockResolvedValue({ data: null, error: null });
  expect((await PATCH(request("", { id, status: "read" }))).status).toBe(404);
});
it("retains CSRF, input bounds and fail-closed protection", async () => {
  expect((await PATCH(request("", { id, status: "read" }, false))).status).toBe(403);
  expect((await GET(request("?limit=51"))).status).toBe(400);
  expect((await PATCH(request("", { id, status: "read", owner_id: owner }))).status).toBe(400);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, degraded: true });
  expect((await GET(request())).status).toBe(503);
});

/** @vitest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  publicRpc: vi.fn(),
  serviceRpc: vi.fn(),
  captcha: vi.fn(),
  guard: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("./server-public", () => ({ foundationServerPublicApi: () => ({ rpc: mocks.publicRpc }) }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: () => ({ rpc: mocks.serviceRpc }) }));
vi.mock("../utils/public-mutation-route", () => ({ verifyPublicTurnstile: mocks.captcha }));
vi.mock("../utils/mutation-guard", () => ({ enforceMutationRequest: mocks.guard }));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: mocks.rate,
  getClientRateLimitIdentity: () => ({ key: "synthetic-visitor" }),
}));
import { revealFoundationContact } from "./contact-reveal-route";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const post = {
  id,
  kind: "listing",
  area: "market",
  category: "electronics",
  activity: null,
  title: "Fixture",
  description: "Fixture",
  price_mode: "amount",
  price_cents: "100",
  price_negotiable: false,
  province: "gp",
  city: "gp_johannesburg",
  locality: "Johannesburg",
  condition: "good",
  published_at: "2026-10-16T12:00:00Z",
  visible_until: "2027-01-01T00:00:00Z",
  event_window: null,
  media: [],
  seller: { public_name: "Tester T.", avatar_object_key: null, identity_verified: true },
};
const request = (
  body: object = { targetType: "listing", targetId: id, turnstileToken: "single-use-token" }
) =>
  new NextRequest("http://localhost/api/contact/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockReturnValue(null);
  mocks.captcha.mockResolvedValue(null);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.publicRpc.mockImplementation(async (name: string) => ({
    data: name === "get_public_post" ? post : ["call", "whatsapp"],
    error: null,
  }));
  mocks.serviceRpc.mockResolvedValue({ data: "+27821234567", error: null });
});

it("verifies one challenge and reveals only selected channels in the existing response shape", async () => {
  const response = await revealFoundationContact(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    phone: "+27821234567",
    whatsapp: "+27821234567",
    email: null,
  });
  expect(mocks.captcha).toHaveBeenCalledTimes(1);
  expect(mocks.rate).toHaveBeenCalledWith(
    expect.objectContaining({ action: "contact:reveal", degradedMode: "block" })
  );
  expect(mocks.serviceRpc.mock.calls.map(([, args]) => args.p_channel)).toEqual([
    "call",
    "whatsapp",
  ]);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});

it("never reveals an unselected channel", async () => {
  mocks.publicRpc.mockImplementation(async (name: string) => ({
    data: name === "get_public_post" ? post : ["whatsapp"],
    error: null,
  }));
  const response = await revealFoundationContact(request());
  expect(await response.json()).toMatchObject({ phone: null, whatsapp: "+27821234567" });
  expect(mocks.serviceRpc).toHaveBeenCalledExactlyOnceWith("reveal_post_phone", {
    p_post_id: id,
    p_channel: "whatsapp",
  });
});

it("blocks missing or failed CAPTCHA before any database access", async () => {
  expect(
    (await revealFoundationContact(request({ targetType: "listing", targetId: id }))).status
  ).toBe(400);
  mocks.captcha.mockResolvedValue(
    NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 })
  );
  expect((await revealFoundationContact(request())).status).toBe(400);
  expect(mocks.publicRpc).not.toHaveBeenCalled();
  expect(mocks.serviceRpc).not.toHaveBeenCalled();
});

it("preserves origin/CSRF rejection and fails closed when the limiter is unavailable", async () => {
  mocks.guard.mockReturnValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
  expect((await revealFoundationContact(request())).status).toBe(403);
  expect(mocks.captcha).not.toHaveBeenCalled();
  mocks.rate.mockResolvedValue({ limited: true, degraded: true });
  expect((await revealFoundationContact(request())).status).toBe(503);
  expect(mocks.publicRpc).not.toHaveBeenCalled();
  expect(mocks.serviceRpc).not.toHaveBeenCalled();
});

it("rejects a wrong target kind or removed post without accessing a phone", async () => {
  expect(
    (
      await revealFoundationContact(
        request({ targetType: "promotion", targetId: id, turnstileToken: "token" })
      )
    ).status
  ).toBe(404);
  mocks.publicRpc.mockResolvedValue({ data: null, error: null });
  expect((await revealFoundationContact(request())).status).toBe(404);
  expect(mocks.serviceRpc).not.toHaveBeenCalled();
});

it("rechecks availability in the service command and hides internal failures", async () => {
  mocks.serviceRpc
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  expect((await revealFoundationContact(request())).status).toBe(404);
  mocks.serviceRpc.mockResolvedValue({ data: null, error: { message: "private diagnostic" } });
  const response = await revealFoundationContact(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private diagnostic");
});

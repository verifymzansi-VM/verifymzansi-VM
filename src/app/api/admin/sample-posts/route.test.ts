/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const { forget } = vi.hoisted(() => ({ forget: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
vi.mock("@/lib/sample-posts/hidden", () => ({ forgetHiddenSampleSlugs: forget }));
vi.mock("@/lib/sample-posts/load", () => ({
  listCatalogueSamples: async () => [{ slug: "fish-braai" }, { slug: "guest-house" }],
}));

import { POST } from "./route";

const csrf = "c".repeat(64);
const rpc = vi.fn();
const hiddenAt = "2026-11-17T14:48:34.030187+00:00";

function request(body: unknown, { csrfOk = true, origin = "https://verifymzansi.com" } = {}) {
  return new NextRequest("https://verifymzansi.com/api/admin/sample-posts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin,
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(csrfOk ? { "x-csrf-token": csrf } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  rpc.mockResolvedValue({
    data: { slug: "fish-braai", hidden: true, hidden_at: hiddenAt },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

it("removes a catalogue sample through the staff command and refreshes this instance", async () => {
  const response = await POST(request({ slug: "fish-braai", hidden: true }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    success: true,
    sample: { slug: "fish-braai", hidden: true, hidden_at: hiddenAt },
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "set_sample_post_hidden",
    { p_slug: "fish-braai", p_hidden: true },
    { get: false }
  );
  expect(forget).toHaveBeenCalledOnce();
});

it("restores a sample", async () => {
  rpc.mockResolvedValueOnce({
    data: { slug: "guest-house", hidden: false, hidden_at: null },
    error: null,
  });
  const response = await POST(request({ slug: "guest-house", hidden: false }));
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "set_sample_post_hidden",
    { p_slug: "guest-house", p_hidden: false },
    { get: false }
  );
});

it("refuses a cross-site or CSRF-less request before any session or command", async () => {
  expect(
    (await POST(request({ slug: "fish-braai", hidden: true }, { csrfOk: false }))).status
  ).toBe(403);
  expect(
    (await POST(request({ slug: "fish-braai", hidden: true }, { origin: "https://evil.example" })))
      .status
  ).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses malformed input and slugs outside the catalogue without a command", async () => {
  for (const body of [
    { slug: "Fish Braai", hidden: true },
    { slug: "fish-braai" },
    { slug: "fish-braai", hidden: "yes" },
    { slug: "fish-braai", hidden: true, by: "someone" },
  ])
    expect((await POST(request(body))).status).toBe(422);
  expect((await POST(request({ slug: "not-in-catalogue", hidden: true }))).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
  expect(forget).not.toHaveBeenCalled();
});

it("sends staff to verify again on a second-factor refusal", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent second-factor verification required" },
  });
  const response = await POST(request({ slug: "fish-braai", hidden: true }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "step_up_required" });
  expect(forget).not.toHaveBeenCalled();
});

it("maps other refusals and an unconfirmed answer", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "capability not granted" },
  });
  expect((await POST(request({ slug: "fish-braai", hidden: true }))).status).toBe(403);
  rpc.mockResolvedValueOnce({ data: null, error: { code: "54000", message: "too many" } });
  expect((await POST(request({ slug: "fish-braai", hidden: true }))).status).toBe(409);
  rpc.mockResolvedValueOnce({
    data: { slug: "fish-braai", hidden: false, hidden_at: null },
    error: null,
  });
  expect((await POST(request({ slug: "fish-braai", hidden: true }))).status).toBe(503);
  expect(forget).not.toHaveBeenCalled();
});

it("is rate limited", async () => {
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 30 });
  expect((await POST(request({ slug: "fish-braai", hidden: true }))).status).toBe(429);
  expect(rpc).not.toHaveBeenCalled();
});

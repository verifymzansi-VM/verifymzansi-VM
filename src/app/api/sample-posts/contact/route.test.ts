/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockFind } = vi.hoisted(() => ({ mockFind: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sample-posts/load", () => ({ findSamplePost: mockFind }));

import { POST } from "./route";

const csrf = "c".repeat(64);
let ip = 0;

function request(body: unknown, { csrfOk = true } = {}) {
  return new NextRequest("https://verifymzansi.com/api/sample-posts/contact", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "cf-connecting-ip": `198.51.100.${ip}`,
      ...(csrfOk ? { "x-csrf-token": csrf } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ip += 1;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.stubEnv("SAMPLE_CONTACT_PHONE", "082 123 4567");
  vi.stubEnv("SAMPLE_CONTACT_WHATSAPP", "0821234568");
  mockFind.mockResolvedValue({ slug: "fish-braai" });
});
afterEach(() => vi.unstubAllEnvs());

it("gives VerifyMzansi's numbers for a shown sample, uncached and without sign-in", async () => {
  const response = await POST(request({ slug: "fish-braai" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ phone: "+27821234567", whatsapp: "+27821234568" });
  expect(mockFind).toHaveBeenCalledWith("fish-braai");
});

it("answers 404 for a sample that is not shown (off, removed or unknown)", async () => {
  mockFind.mockResolvedValue(null);
  expect((await POST(request({ slug: "fish-braai" }))).status).toBe(404);
  for (const body of [{ slug: "Fish Braai" }, {}, { slug: "fish-braai", extra: 1 }])
    expect((await POST(request(body))).status).toBe(404);
});

it("answers 404 while no valid number is set", async () => {
  vi.stubEnv("SAMPLE_CONTACT_PHONE", "");
  vi.stubEnv("SAMPLE_CONTACT_WHATSAPP", "12345");
  expect((await POST(request({ slug: "fish-braai" }))).status).toBe(404);
});

it("refuses a request without the CSRF token", async () => {
  expect((await POST(request({ slug: "fish-braai" }, { csrfOk: false }))).status).toBe(403);
  expect(mockFind).not.toHaveBeenCalled();
});

it("limits each visitor to 20 requests a minute", async () => {
  const statuses = [];
  for (let i = 0; i < 21; i += 1)
    statuses.push((await POST(request({ slug: "fish-braai" }))).status);
  expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
  expect(statuses[20]).toBe(429);
});

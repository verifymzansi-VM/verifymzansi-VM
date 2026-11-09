/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";
import { POST } from "./route";
vi.mock("@/lib/foundation/billing-route", () => ({ handleFoundationBillingRoute: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const token = "b".repeat(64);
const body = { post_id: id, kind: "urgent", days: 7 };
const paused = {
  error: "Add-ons open soon. You have not been charged.",
  code: "addon_sales_paused",
};
const request = (value: unknown, csrf = true, origin = "https://verifymzansi.com") =>
  new NextRequest("https://verifymzansi.com/api/foundation/billing/addon", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(csrf ? { Cookie: `vm_csrf=${token}`, "x-csrf-token": token } : {}),
    },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.mocked(handleFoundationBillingRoute).mockResolvedValue(NextResponse.json({ checkout: true }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("while paid add-on sales are paused (the default)", () => {
  it("refuses with the friendly reply before any billing work", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(paused);
    expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
  });
  it.each(["", "false", "TRUE", "True", "1", "yes", "on", " true", "true ", "enabled"])(
    "stays paused when the switch is %j",
    async (value) => {
      vi.stubEnv("ADDON_SALES_ENABLED", value);
      const response = await POST(request(body));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(paused);
      expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
    }
  );
  it.each([
    { ...body, kind: "boost" },
    { ...body, kind: "featured" },
    { ...body, kind: "URGENT" },
    { ...body, kind: ["urgent"] },
    { ...body, amount_cents: 1 },
    { planId: id },
    [body],
    "urgent",
    null,
  ])("refuses every request body the same way: %j", async (value) => {
    const response = await POST(request(value));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(paused);
    expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
  });
  it("refuses requests without CSRF or from another site the same way, first", async () => {
    for (const incoming of [request(body, false), request(body, true, "https://x.invalid")]) {
      const response = await POST(incoming);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(paused);
    }
    expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
  });
  it("refuses the existing add-on URLs before the backend is chosen", async () => {
    const route = createAddonCheckoutRouteCore({
      paramsSchema: z.object({ id: z.uuid() }),
      activeUntilField: "urgent_until",
      paymentType: "urgent",
      durationDays: 7,
      getEntityId: (value: { id: string }) => value.id,
      validationErrorMessage: "Invalid post",
    } as never);
    const response = await route(request({}), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(paused);
    expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("once paid add-on sales are switched on", () => {
  beforeEach(() => vi.stubEnv("ADDON_SALES_ENABLED", "true"));
  it("forwards only the requested post and catalogue selector to authenticated billing", async () => {
    const incoming = request(body);
    expect((await POST(incoming)).status).toBe(200);
    expect(handleFoundationBillingRoute).toHaveBeenCalledExactlyOnceWith(incoming, "checkout", {
      postId: id,
      kind: "urgent",
      days: 7,
    });
  });
  it.each([
    { ...body, amount_cents: 1 },
    { ...body, owner_id: id },
    { ...body, kind: "arbitrary" },
    { ...body, days: 0 },
  ])("rejects client price/owner authority and unsupported selectors", async (input) => {
    expect((await POST(request(input))).status).toBe(400);
    expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
  });
  it("requires origin and CSRF before starting any checkout", async () => {
    expect((await POST(request(body, false))).status).toBe(403);
    expect((await POST(request(body, true, "https://untrusted.example.invalid"))).status).toBe(403);
    expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
  });
  it("selects foundation before any legacy table client in the existing add-on URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    const route = createAddonCheckoutRouteCore({
      paramsSchema: z.object({ id: z.uuid() }),
      activeUntilField: "featured_until",
      durationDays: 7,
      getEntityId: (value: { id: string }) => value.id,
      validationErrorMessage: "Invalid post",
    } as never);
    const incoming = request({});
    expect((await route(incoming, { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(handleFoundationBillingRoute).toHaveBeenCalledExactlyOnceWith(incoming, "checkout", {
      postId: id,
      kind: "featured",
      days: 7,
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

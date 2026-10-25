/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  vi.mocked(handleFoundationBillingRoute).mockResolvedValue(NextResponse.json({ checkout: true }));
});
afterEach(() => vi.unstubAllEnvs());
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

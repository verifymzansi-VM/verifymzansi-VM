/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import { createHostedCheckout } from "@/lib/payments/checkout";
import type * as Checkout from "@/lib/payments/checkout";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Every website URL that can start a paid add-on purchase, on either backend,
// refuses while add-on sales are paused (src/lib/billing/addon-sales.ts).
vi.mock("@/lib/foundation/billing-route", () => ({ handleFoundationBillingRoute: vi.fn() }));
vi.mock("@/lib/payments/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof Checkout>()),
  createHostedCheckout: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const id = "00000000-0000-4000-8000-000000000001";
const token = "d".repeat(64);
const paused = {
  error: "Add-ons open soon. You have not been charged.",
  code: "addon_sales_paused",
};
type Handler = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;
const routes: [string, () => Promise<{ POST: Handler }>][] = [
  ["listings/[id]/urgent", () => import("@/app/api/listings/[id]/urgent/route")],
  ["listings/[id]/boost", () => import("@/app/api/listings/[id]/boost/route")],
  ["listings/[id]/featured", () => import("@/app/api/listings/[id]/featured/route")],
  ["businesses/[id]/urgent", () => import("@/app/api/businesses/[id]/urgent/route")],
  ["businesses/[id]/boost", () => import("@/app/api/businesses/[id]/boost/route")],
  ["businesses/[id]/featured", () => import("@/app/api/businesses/[id]/featured/route")],
  ["promotions/[id]/urgent", () => import("@/app/api/promotions/[id]/urgent/route")],
  ["promotions/[id]/boost", () => import("@/app/api/promotions/[id]/boost/route")],
  ["promotions/[id]/featured", () => import("@/app/api/promotions/[id]/featured/route")],
];
const request = (path: string, body?: unknown) =>
  new NextRequest(`https://verifymzansi.com/api/${path.replace("[id]", id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://verifymzansi.com",
      Cookie: `vm_csrf=${token}`,
      "x-csrf-token": token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function expectNothingStarted() {
  expect(handleFoundationBillingRoute).not.toHaveBeenCalled();
  expect(createHostedCheckout).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
  expect(createAdminClient).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(routes)("POST /api/%s while add-on sales are paused", (path, load) => {
  it("refuses on foundation before any session, table or provider work", async () => {
    const { POST } = await load();
    const response = await POST(request(path), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(paused);
    expectNothingStarted();
  });

  it.each([
    { kind: "urgent", days: 7 },
    { planId: id },
    { amount_cents: 1, owner_id: id },
    [{ kind: "urgent" }],
  ])("refuses whatever body is sent (%j)", async (body) => {
    const { POST } = await load();
    const response = await POST(request(path, body), { params: Promise.resolve({ id }) });
    expect(await response.json()).toEqual(paused);
    expectNothingStarted();
  });

  it("refuses an invalid post id the same way", async () => {
    const { POST } = await load();
    const response = await POST(request(path), { params: Promise.resolve({ id: "not-a-post" }) });
    expect(await response.json()).toEqual(paused);
    expectNothingStarted();
  });

  // legacy-backend: this case covers the old ("source") backend path and runs in
  // the foundation vitest project with the backend stubbed. Delete it together
  // with the old backend (see src/test/legacy-backend-suites.ts).
  it("refuses on the old backend before any session, table or provider work", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "source");
    const { POST } = await load();
    const response = await POST(request(path), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(paused);
    expectNothingStarted();
  });
});

describe.each(routes)("POST /api/%s once add-on sales are switched on", (path, load) => {
  it("hands the add-on checkout to foundation billing as before", async () => {
    vi.stubEnv("ADDON_SALES_ENABLED", "true");
    vi.mocked(handleFoundationBillingRoute).mockResolvedValue(new Response("{}") as never);
    const { POST } = await load();
    await POST(request(path), { params: Promise.resolve({ id }) });
    expect(handleFoundationBillingRoute).toHaveBeenCalledExactlyOnceWith(
      expect.any(NextRequest),
      "checkout",
      {
        postId: id,
        kind: path.split("/").at(-1),
        days: 7,
      }
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/foundation/billing-route", () => ({ handleFoundationBillingRoute: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

// Production (foundation) answers this retired route through the shared
// billing handler; the handler's 410 is tested in billing-route.test.ts.
it("hands the request to the foundation billing handler as retired", async () => {
  const answer = NextResponse.json({ code: "LEGACY_PLAN_ROUTE_RETIRED" }, { status: 410 });
  vi.mocked(handleFoundationBillingRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/billing/cancel", {
    method: "POST",
  });
  expect(await POST(request)).toBe(answer);
  expect(handleFoundationBillingRoute).toHaveBeenCalledExactlyOnceWith(request, "retired");
  expect(createAdminClient).not.toHaveBeenCalled();
});

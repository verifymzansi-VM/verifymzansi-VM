/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";

vi.mock("@/lib/foundation/billing-route", () => ({ handleFoundationBillingRoute: vi.fn() }));

// The shared billing handler owns sign-in, CSRF, rate limits and validation
// for this route; those are tested in src/lib/foundation/billing-route.test.ts.
it("hands the request to the foundation billing handler as cancel-pending", async () => {
  const answer = NextResponse.json({ ok: true });
  vi.mocked(handleFoundationBillingRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/billing/cancel-pending", {
    method: "POST",
  });
  expect(await POST(request)).toBe(answer);
  expect(handleFoundationBillingRoute).toHaveBeenCalledExactlyOnceWith(request, "cancel-pending");
});

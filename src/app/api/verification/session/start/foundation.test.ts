/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleRestoredVerificationSession } from "@/lib/foundation/restored-verification-route";

vi.mock("@/lib/foundation/restored-verification-route", () => ({
  handleRestoredVerificationSession: vi.fn(),
}));

// The restored verification route owns CSRF, sign-in and the account checks;
// it is tested in src/lib/foundation/restored-verification-route.test.ts.
it("starts or resumes verification through the restored session handler", async () => {
  const answer = NextResponse.json({ steps: [] });
  vi.mocked(handleRestoredVerificationSession).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/verification/session/start", {
    method: "POST",
  });
  expect(await POST(request)).toBe(answer);
  expect(handleRestoredVerificationSession).toHaveBeenCalledExactlyOnceWith(request);
});

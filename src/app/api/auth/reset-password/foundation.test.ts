/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "./route";
import { handleFoundationRecoveryCompletion } from "@/app/api/foundation/auth/_lib/recovery-complete";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/app/api/foundation/auth/_lib/recovery-complete", () => ({
  handleFoundationRecoveryCompletion: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

const url = "https://verifymzansi.com/api/auth/reset-password";
beforeEach(() => vi.clearAllMocks());

it("checks the recovery session through the foundation handler without changing it", async () => {
  const answer = NextResponse.json({ valid: true });
  vi.mocked(handleFoundationRecoveryCompletion).mockResolvedValueOnce(answer);
  const request = new NextRequest(url);
  expect(await GET(request)).toBe(answer);
  expect(handleFoundationRecoveryCompletion).toHaveBeenCalledExactlyOnceWith(request, false);
  expect(createAdminClient).not.toHaveBeenCalled();
});

it("completes the reset through the foundation handler", async () => {
  const answer = NextResponse.json({ success: true });
  vi.mocked(handleFoundationRecoveryCompletion).mockResolvedValueOnce(answer);
  const request = new NextRequest(url, { method: "POST" });
  expect(await POST(request)).toBe(answer);
  expect(handleFoundationRecoveryCompletion).toHaveBeenCalledExactlyOnceWith(request, true);
  expect(createAdminClient).not.toHaveBeenCalled();
});

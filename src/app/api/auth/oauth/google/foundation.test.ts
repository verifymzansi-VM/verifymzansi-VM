/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationGoogleOAuth } from "@/app/api/foundation/auth/_lib/google-oauth";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/app/api/foundation/auth/_lib/google-oauth", () => ({
  handleFoundationGoogleOAuth: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

it("hands Google sign-in to the foundation handler", async () => {
  const answer = NextResponse.json({ url: "https://accounts.google.com/o/oauth2" });
  vi.mocked(handleFoundationGoogleOAuth).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/auth/oauth/google", {
    method: "POST",
  });
  expect(await POST(request)).toBe(answer);
  expect(handleFoundationGoogleOAuth).toHaveBeenCalledExactlyOnceWith(request);
  expect(createAdminClient).not.toHaveBeenCalled();
});

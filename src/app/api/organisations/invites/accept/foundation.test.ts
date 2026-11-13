/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleOrganisationRoute } from "@/app/api/foundation/_lib/organisation-route";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/app/api/foundation/_lib/organisation-route", () => ({
  handleOrganisationRoute: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

it("accepts the invitation through the foundation organisation route", async () => {
  const answer = NextResponse.json({ success: true });
  vi.mocked(handleOrganisationRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest("https://verifymzansi.com/api/organisations/invites/accept", {
    method: "POST",
  });
  expect(await POST(request)).toBe(answer);
  expect(handleOrganisationRoute).toHaveBeenCalledExactlyOnceWith(
    request,
    "organisation:invite",
    true,
    expect.any(Function)
  );
  expect(createAdminClient).not.toHaveBeenCalled();
});

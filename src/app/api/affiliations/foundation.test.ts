/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "./route";
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

const url = "https://verifymzansi.com/api/affiliations";
beforeEach(() => vi.clearAllMocks());

it("reads the member's affiliations through the foundation organisation route", async () => {
  const answer = NextResponse.json({ applications: [], affiliations: [] });
  vi.mocked(handleOrganisationRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest(url);
  expect(await GET(request)).toBe(answer);
  expect(handleOrganisationRoute).toHaveBeenCalledExactlyOnceWith(
    request,
    "organisation:read",
    false,
    expect.any(Function)
  );
  expect(createAdminClient).not.toHaveBeenCalled();
});

it("sends affiliation requests through the foundation organisation route", async () => {
  const answer = NextResponse.json({ success: true });
  vi.mocked(handleOrganisationRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest(url, { method: "POST" });
  expect(await POST(request)).toBe(answer);
  expect(handleOrganisationRoute).toHaveBeenCalledExactlyOnceWith(
    request,
    "organisation:apply",
    true,
    expect.any(Function)
  );
  expect(createAdminClient).not.toHaveBeenCalled();
});

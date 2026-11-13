/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
import { handlePublicOrganisationRead } from "@/app/api/foundation/_lib/organisation-route";
import { readRestoredBusinessAffiliations } from "@/lib/foundation/public-business-affiliations";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/app/api/foundation/_lib/organisation-route", () => ({
  handlePublicOrganisationRead: vi.fn(),
}));
vi.mock("@/lib/foundation/public-business-affiliations", () => ({
  readRestoredBusinessAffiliations: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

const business = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const url = "https://verifymzansi.com/api/organisations/affiliations";
beforeEach(() => vi.clearAllMocks());

it("answers an empty list without a foundation call when no ids are valid", async () => {
  const res = await GET(new NextRequest(`${url}?ids=not-a-uuid,`));
  expect(await res.json()).toEqual({ affiliations: [] });
  expect(handlePublicOrganisationRead).not.toHaveBeenCalled();
});

it("reads the badges through the foundation public organisation read", async () => {
  const answer = NextResponse.json({ affiliations: [] });
  vi.mocked(handlePublicOrganisationRead).mockResolvedValueOnce(answer);
  const request = new NextRequest(`${url}?ids=${business},bogus`);
  expect(await GET(request)).toBe(answer);
  const [handed, read] = vi.mocked(handlePublicOrganisationRead).mock.calls[0];
  expect(handed).toBe(request);
  vi.mocked(readRestoredBusinessAffiliations).mockResolvedValueOnce([]);
  await expect(read({} as never)).resolves.toEqual({ affiliations: [] });
  expect(readRestoredBusinessAffiliations).toHaveBeenCalledWith({}, [business]);
  expect(createAdminClient).not.toHaveBeenCalled();
});

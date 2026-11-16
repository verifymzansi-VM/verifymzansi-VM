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

const org = "3a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d";
const application = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

it("manages the organisation through the foundation organisation route", async () => {
  const answer = NextResponse.json({ success: true });
  vi.mocked(handleOrganisationRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest(`https://verifymzansi.com/api/organisations/${org}/manage`, {
    method: "POST",
  });
  expect(await POST(request, { params: Promise.resolve({ id: org }) })).toBe(answer);
  const [handed, action, mutate, command] = vi.mocked(handleOrganisationRoute).mock.calls[0];
  expect([handed, action, mutate]).toEqual([request, "organisation:manage", true]);

  const rpc = vi.fn().mockResolvedValue({ data: { id: application }, error: null });
  await command({ rpc } as never, {
    action: "decide",
    applicationId: application,
    decision: "approve",
  });
  expect(rpc).toHaveBeenCalledWith(
    "execute_frontend_organisation_action",
    { p_org: org, p_item: application, p_action: "decide", p_value: "approve" },
    { get: false }
  );
  expect(createAdminClient).not.toHaveBeenCalled();
});

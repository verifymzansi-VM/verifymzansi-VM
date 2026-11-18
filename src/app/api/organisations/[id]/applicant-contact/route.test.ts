/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleOrganisationRoute } from "@/app/api/foundation/_lib/organisation-route";
import { FoundationOrganisationError } from "@/lib/foundation/organisations";

vi.mock("@/app/api/foundation/_lib/organisation-route", () => ({
  handleOrganisationRoute: vi.fn(),
}));

const org = "3a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d";
const application = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
const contact = {
  application_id: application,
  phone: "+27820000201",
  email: "pending@example.invalid",
  website: null,
};

async function command() {
  const answer = NextResponse.json(contact);
  vi.mocked(handleOrganisationRoute).mockResolvedValueOnce(answer);
  const request = new NextRequest(
    `https://verifymzansi.com/api/organisations/${org}/applicant-contact`,
    { method: "POST" }
  );
  expect(await POST(request, { params: Promise.resolve({ id: org }) })).toBe(answer);
  const [handed, action, mutate, run] = vi.mocked(handleOrganisationRoute).mock.calls.at(-1)!;
  // Rate limited like a post's "Show number"; a mutation, so origin and CSRF
  // are checked.
  expect([handed, action, mutate]).toEqual([request, "contact:reveal", true]);
  return run;
}

it("reveals one pending application's contact through its own command", async () => {
  const run = await command();
  const rpc = vi.fn().mockResolvedValue({ data: contact, error: null });
  expect(await run({ rpc } as never, { applicationId: application })).toEqual(contact);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "reveal_organisation_applicant_contact",
    { p_application: application },
    { get: false }
  );
});

it("refuses other input, another application's answer and a decided application", async () => {
  const run = await command();
  const rpc = vi.fn();
  await expect(
    run({ rpc } as never, { applicationId: application, extra: 1 })
  ).rejects.toBeInstanceOf(FoundationOrganisationError);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce({
    data: { ...contact, application_id: "00000000-0000-4000-8000-000000000000" },
    error: null,
  });
  await expect(run({ rpc } as never, { applicationId: application })).rejects.toMatchObject({
    reason: "unavailable",
  });
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "PT409", details: "application_state", message: "pending only" },
  });
  await expect(run({ rpc } as never, { applicationId: application })).rejects.toMatchObject({
    reason: "conflict",
  });
});

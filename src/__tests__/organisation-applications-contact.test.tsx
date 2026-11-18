// Organisation dashboard, Applications: an applicant's business contact shows
// only for a pending application and only after "Show contact"
// (database update 20261118072601_staff_data_minimisation.sql).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ApplicationsReview,
  type OrganisationApplicationRow,
} from "@/components/organisations/organisation-management";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (headers: Record<string, string>) => headers,
}));

const organisationId = "11111111-1111-4111-8111-111111111111";
function row(
  id: string,
  status: string,
  overrides: Partial<OrganisationApplicationRow> = {}
): OrganisationApplicationRow {
  return {
    id,
    status,
    business_id: "22222222-2222-4222-8222-222222222222",
    business_name: `Business ${status}`,
    category: null,
    city: null,
    province: null,
    business_phone: null,
    business_email: null,
    business_website: null,
    representative_name: null,
    identity_verified: true,
    programme_name: null,
    reason: null,
    member_reference: null,
    info_request: null,
    info_response: null,
    submitted_at: "2026-11-18T08:00:00Z",
    decision_at: null,
    decision_note: null,
    ...overrides,
  };
}
const pending = "33333333-3333-4333-8333-000000000001";
const declined = "33333333-3333-4333-8333-000000000002";

beforeEach(() => vi.restoreAllMocks());

describe("ApplicationsReview contact reveal", () => {
  it("shows a pending applicant's contact only on request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          application_id: pending,
          phone: "+27820000201",
          email: "pending@example.invalid",
          website: null,
        }),
        { status: 200 }
      )
    );
    render(
      <ApplicationsReview
        organisationId={organisationId}
        applications={[row(pending, "submitted")]}
        revealContacts
      />
    );
    expect(screen.queryByText(/\+27820000201/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show contact" }));
    await waitFor(() =>
      expect(screen.getByText("+27820000201 · pending@example.invalid")).toBeTruthy()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/organisations/${organisationId}/applicant-contact`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ applicationId: pending }) })
    );
  });

  it("offers no reveal for a decided application", () => {
    render(
      <ApplicationsReview
        organisationId={organisationId}
        applications={[row(declined, "declined")]}
        revealContacts
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /^Declined/ }));
    expect(screen.queryByRole("button", { name: "Show contact" })).toBeNull();
    expect(screen.getByText("Business contact:").nextSibling?.textContent).toBe("—");
  });

  it("keeps contacts the page already holds inline (staff page)", () => {
    render(
      <ApplicationsReview
        organisationId={organisationId}
        applications={[row(pending, "submitted", { business_phone: "+27820000999" })]}
      />
    );
    expect(screen.getByText("+27820000999")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show contact" })).toBeNull();
  });

  it("shows the refusal when the contact cannot be shown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "This has changed or is already done" }), {
        status: 409,
      })
    );
    render(
      <ApplicationsReview
        organisationId={organisationId}
        applications={[row(pending, "more_info_required")]}
        revealContacts
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /^More information/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show contact" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already done/));
  });
});

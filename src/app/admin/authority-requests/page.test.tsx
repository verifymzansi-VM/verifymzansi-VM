import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import AuthorityRequestsPage from "./page";

const { listIdentityDisclosures, readStaffAuthenticatorHint, redirectMock, push } = vi.hoisted(
  () => ({
    listIdentityDisclosures: vi.fn(),
    readStaffAuthenticatorHint: vi.fn(),
    push: vi.fn(),
    redirectMock: vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }),
  })
);

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api: { rpc: vi.fn() } })),
}));
vi.mock("@/lib/foundation/identity-disclosures", () => ({
  listIdentityDisclosures,
  readStaffAuthenticatorHint,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  number: 42,
  opened_at: "2026-11-18T08:00:00Z",
  opened_by_name: "Senzo N.",
  request_type: "subpoena",
  reference: "CAS 88/11/2026",
  outcome: "record",
  viewed: true,
  printed: true,
  ...overrides,
});

describe("AuthorityRequestsPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    listIdentityDisclosures.mockResolvedValue([]);
    readStaffAuthenticatorHint.mockResolvedValue(Math.floor(Date.now() / 1000) - 3 * 60 - 10);
  });

  it("needs identity:disclose (governors and admins)", async () => {
    render(await AuthorityRequestsPage());
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("identity:disclose");
    expect(screen.getByRole("heading", { level: 1, name: "Authority requests" })).toBeVisible();
    expect(screen.getByText(/Every opening is logged/)).toBeVisible();
  });

  it("shows how long the 2-step check still lets staff open a record", async () => {
    render(await AuthorityRequestsPage());
    expect(screen.getByText("2-step check done 3 minutes ago.")).toBeVisible();
    expect(screen.getByText(/open a record for 12 more minutes/)).toBeVisible();
  });

  it("offers post, ID number, phone and email searches, never a name", async () => {
    render(await AuthorityRequestsPage());
    const options = Array.from(
      (screen.getByLabelText("Search by") as HTMLSelectElement).options
    ).map((option) => option.value);
    expect(options).toEqual(["post", "id_number", "phone", "email"]);
    expect(screen.getByText(/Searching by name is not allowed/)).toBeVisible();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText(/A search that finds nobody is logged too/)).toBeVisible();
  });

  it("offers only a subpoena, court order, search warrant or urgent life-risk request", async () => {
    render(await AuthorityRequestsPage());
    const types = Array.from(
      (screen.getByLabelText("Type of request") as HTMLSelectElement).options
    ).map((option) => option.value);
    expect(types).toEqual(["subpoena", "court_order", "search_warrant", "urgent_life_risk"]);
    expect(screen.getByLabelText("Issuing court")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Type of request"), {
      target: { value: "urgent_life_risk" },
    });
    expect(screen.getByLabelText("SAPS station")).toBeVisible();
    expect(screen.getByLabelText("Case number on the written request")).toBeVisible();
    expect(screen.getByText(/never the selfie/)).toBeVisible();
  });

  it("opens the record page after the database logged the opening", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "00000000-0000-4000-8000-000000000009", number: 43 })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(await AuthorityRequestsPage());
    fireEvent.change(screen.getByLabelText("Case number on the court document"), {
      target: { value: "CAS 123/11/2026" },
    });
    fireEvent.change(screen.getByLabelText("Issuing court"), {
      target: { value: "Richards Bay Magistrate's Court" },
    });
    fireEvent.change(screen.getByLabelText("Official number you called"), {
      target: { value: "035 789 1234" },
    });
    fireEvent.change(screen.getByLabelText("Who confirmed it"), {
      target: { value: "Ms T. Zulu, clerk of the court" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/admin/authority-requests/00000000-0000-4000-8000-000000000009"
      )
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      requestType: "subpoena",
      reference: "CAS 123/11/2026",
      issuedBy: "Richards Bay Magistrate's Court",
      confirmedNumber: "035 789 1234",
      confirmedBy: "Ms T. Zulu, clerk of the court",
      attested: true,
    });
    vi.unstubAllGlobals();
  });

  it("shows a refusal next to the field it is about", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error:
              "Confirm that the request is genuine, signed, and names this person or this post.",
            reason: "disclosure_attestation_required",
          },
          { status: 422 }
        )
      )
    );
    render(await AuthorityRequestsPage());
    fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("genuine, signed");
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
    vi.unstubAllGlobals();
  });

  it("marks the official number when it is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "Enter the official number you called to check the request (digits and spaces).",
            reason: "disclosure_confirmed_number_required",
          },
          { status: 422 }
        )
      )
    );
    render(await AuthorityRequestsPage());
    fireEvent.click(screen.getByRole("button", { name: "Open record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("official number");
    expect(screen.getByLabelText("Official number you called")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    vi.unstubAllGlobals();
  });

  it("lists earlier requests with their status, without the person", async () => {
    listIdentityDisclosures.mockResolvedValue([
      item(),
      item({
        id: "00000000-0000-4000-8000-000000000002",
        number: 41,
        printed: false,
        reference: "Subpoena 2026/4471",
      }),
      item({
        id: "00000000-0000-4000-8000-000000000003",
        number: 40,
        outcome: "no_match",
        printed: false,
        reference: "CAS 301/10/2026",
      }),
    ]);
    render(await AuthorityRequestsPage());
    expect(screen.getByText("Printed")).toBeVisible();
    expect(screen.getByText("Viewed only")).toBeVisible();
    expect(screen.getByText("No match found")).toBeVisible();
    expect(screen.getByText(/D-0042 · .* · opened by Senzo N\./)).toBeVisible();
  });

  it("sends staff to confirm their authenticator, then back here", async () => {
    listIdentityDisclosures.mockRejectedValue(
      new FoundationStaffCommandError(403, "Verify again", true)
    );
    await expect(AuthorityRequestsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(
      "/staff/two-step?confirm=1&next=%2Fadmin%2Fauthority-requests"
    );
  });

  it("does not claim an empty list when the read fails", async () => {
    listIdentityDisclosures.mockRejectedValue(new Error("down"));
    render(await AuthorityRequestsPage());
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText(/No record has been opened yet/)).toBeNull();
  });
});

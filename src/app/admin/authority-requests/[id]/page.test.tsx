import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { AuthorityRequestRefused } from "@/lib/foundation/identity-disclosures";
import RecordPage from "./page";
import SheetPage from "./sheet/page";

const { readIdentityDisclosure, redirectMock, notFoundMock } = vi.hoisted(() => ({
  readIdentityDisclosure: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api: { rpc: vi.fn() } })),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));
vi.mock("@/lib/foundation/identity-disclosures", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readIdentityDisclosure,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/shared/brand-logo", () => ({ BrandLogo: () => <span>VerifyMzansi</span> }));

const ID = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000003";
const AT = "2026-03-03T08:00:00Z";
const disclosure = {
  id: ID,
  number: 42,
  opened_at: "2026-11-20T12:32:00Z",
  closes_at: new Date(Date.now() + 15 * 60000).toISOString(),
  opened_by_name: "Senzo N.",
  request_type: "subpoena",
  reference: "CAS 123/11/2026",
  requested_by: "Det. Sgt. Synthetic, SAPS Test Station",
  request_date: "2026-11-19",
  reason: "Fraud investigation into a reported listing.",
  lookup_kind: "post",
  lookup_value: "red-bicycle",
  outcome: "record",
  match_count: 1,
};
const record = {
  account_id: OWNER,
  kept: true,
  account_closed_at: "2026-10-15T08:00:00Z",
  legal_first_name: "Thando Sipho",
  legal_last_name: "Dlamini",
  verified_at: AT,
  verification_revoked_at: null,
  checked_by: "staff_review",
  id_number_kept: true,
  id_number_erased_at: null,
  id_number: "8001015009087",
  id_number_unreadable: false,
  selfie: { kept: true, taken_at: AT, deleted_at: null },
  id_photo: { kept: false, taken_at: AT, deleted_at: "2026-04-02T08:00:00Z" },
  phones: [
    { phone: "+27712345678", verified_at: AT, revoked_at: null },
    {
      phone: "+27825550101",
      verified_at: "2026-02-02T08:00:00Z",
      revoked_at: "2026-03-01T08:00:00Z",
    },
  ],
};
const params = Promise.resolve({ id: ID });

describe("Authority request record and disclosure sheet", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])])))
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:selfie", revokeObjectURL: vi.fn() })
    );
    readIdentityDisclosure.mockResolvedValue({ disclosure, records: [record] });
  });

  it("shows the logged disclosure, the full names, ID number and every phone", async () => {
    render(await RecordPage({ params }));
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("identity:disclose");
    expect(readIdentityDisclosure).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "staff-1",
      ID,
      "view"
    );
    expect(screen.getByText("Logged as disclosure D-0042.")).toBeVisible();
    expect(screen.getByText(/closes by itself 15 minutes after it was opened/)).toBeVisible();
    expect(screen.getByText("Thando Sipho Dlamini")).toBeVisible();
    expect(screen.getByText("800101 5009 08 7")).toBeVisible();
    expect(screen.getByText("+27 71 234 5678")).toBeVisible();
    expect(screen.getByText(/Earlier number: \+27 82 555 0101/)).toBeVisible();
    expect(screen.getByText("Deleted")).toBeVisible();
    expect(screen.getByRole("link", { name: /Print disclosure sheet/ })).toHaveAttribute(
      "href",
      `/admin/authority-requests/${ID}/sheet`
    );
    expect(screen.getByRole("button", { name: "Close record" })).toBeVisible();
  });

  it("says a search found nobody, and that it is logged", async () => {
    readIdentityDisclosure.mockResolvedValue({
      disclosure: { ...disclosure, outcome: "no_match", match_count: 0 },
      records: [],
    });
    render(await RecordPage({ params }));
    expect(screen.getByRole("heading", { name: "No match found" })).toBeVisible();
    expect(screen.getByText(/The search is logged as/)).toBeVisible();
  });

  it("for an ID number only tried, confirms the attempt and nothing more", async () => {
    readIdentityDisclosure.mockResolvedValue({
      disclosure: {
        ...disclosure,
        outcome: "attempt_only",
        lookup_kind: "id_number",
        lookup_value: null,
      },
      records: [{ account_id: OWNER, kept: false, attempts: [AT] }],
    });
    render(await RecordPage({ params }));
    expect(screen.getByText(/was tried on account/)).toBeVisible();
    expect(screen.queryByText("Full names as on the ID")).toBeNull();
  });

  it("goes back to the list once the record closed, and to the two-step check when the code is old", async () => {
    readIdentityDisclosure.mockRejectedValueOnce(
      new AuthorityRequestRefused(410, "disclosure_closed")
    );
    await expect(RecordPage({ params })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenLastCalledWith("/admin/authority-requests");
    readIdentityDisclosure.mockRejectedValueOnce(
      new FoundationStaffCommandError(403, "Verify", true)
    );
    await expect(RecordPage({ params })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenLastCalledWith(
      `/staff/two-step?confirm=1&next=${encodeURIComponent(`/admin/authority-requests/${ID}`)}`
    );
    readIdentityDisclosure.mockRejectedValueOnce(
      new AuthorityRequestRefused(404, "disclosure_unavailable")
    );
    await expect(RecordPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(RecordPage({ params: Promise.resolve({ id: "D-0042" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
  });

  it("prints a watermarked sheet with the number, reference, staff member and time", async () => {
    const { container } = render(await SheetPage({ params }));
    expect(readIdentityDisclosure).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "staff-1",
      ID,
      "print"
    );
    const sheet = container.querySelector("article")!;
    expect(within(sheet).getByText("Identity record disclosure D-0042")).toBeVisible();
    expect(within(sheet).getByText("Subpoena (Criminal Procedure Act, s205)")).toBeVisible();
    expect(within(sheet).getByText("Det. Sgt. Synthetic, SAPS Test Station")).toBeVisible();
    expect(sheet.textContent).toMatch(/CONFIDENTIAL · D-0042 · Senzo N\./);
    expect(sheet.textContent).toMatch(/D-0042 · CAS 123\/11\/2026 · Senzo N\./);
    expect(within(sheet).getByText("Thando Sipho Dlamini")).toBeVisible();
    expect(screen.getByRole("button", { name: /Print or save as PDF/ })).toBeVisible();
    // Not a spreadsheet export: there is no CSV link.
    expect(container.querySelector('a[href$=".csv"], a[download]')).toBeNull();
  });
});

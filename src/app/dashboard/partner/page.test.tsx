import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PartnerDashboardPage from "./page";

const { readFoundationPartnerDashboard, switches } = vi.hoisted(() => ({
  readFoundationPartnerDashboard: vi.fn(),
  switches: { SHOW_PARTNER_PAGE: false },
}));

vi.mock("@/lib/hidden-features", () => ({
  get SHOW_PARTNER_PAGE() {
    return switches.SHOW_PARTNER_PAGE;
  },
}));
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api: { rpc: vi.fn() } })),
}));
vi.mock("@/lib/foundation/partners", () => ({ readFoundationPartnerDashboard }));

// The partner summary as api.my_partner_dashboard returns it.
const SUMMARY = {
  code: "THANDO1",
  status: "active",
  rate_bps: 2000,
  referrals: 7,
  paying_referrals: 3,
  totals: { pending: "12000", approved: "4500", paid: "30000", reversed: "1000" },
  recent: [
    {
      id: "8b0b6c8e-4f5c-4bb5-9a59-2b0a7d6f0001",
      amount_cents: "12000",
      base_cents: "60000",
      status: "pending",
      created_at: new Date().toISOString(),
      eligible_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      paid_at: null,
    },
  ],
};

async function renderPage() {
  return render(await PartnerDashboardPage());
}

function headings(level: number) {
  return screen.getAllByRole("heading", { level }).map((h) => h.textContent);
}

beforeEach(() => {
  switches.SHOW_PARTNER_PAGE = false;
  readFoundationPartnerDashboard.mockReset();
  readFoundationPartnerDashboard.mockResolvedValue(SUMMARY);
});

describe("partner page with the switch off (today's page)", () => {
  it("shows today's sections and figures, and nothing from the redesign", async () => {
    await renderPage();
    expect(headings(2)).toEqual(["Your referral link", "Recent commission"]);
    expect(screen.getByText("https://verifymzansi.com/?ref=THANDO1")).toBeInTheDocument();
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    expect(terms).toEqual(["Referred accounts", "Paying referrals", "Pending", "Approved / paid"]);
    expect(screen.getByText("R345")).toBeInTheDocument();
    for (const text of [/Earned this month/, /Next payout/, /WhatsApp/, /QR code/, /Partner rules/])
      expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

  it("is the same for someone who is not a partner, whichever way the switch is set", async () => {
    readFoundationPartnerDashboard.mockResolvedValue(null);
    const off = (await renderPage()).container.innerHTML;
    expect(screen.getByText(/You are not a VerifyMzansi partner yet/)).toBeInTheDocument();
    document.body.innerHTML = "";
    switches.SHOW_PARTNER_PAGE = true;
    expect((await renderPage()).container.innerHTML).toBe(off);
  });
});

describe("partner page with the switch on", () => {
  beforeEach(() => {
    switches.SHOW_PARTNER_PAGE = true;
  });

  it("shows the redesigned sections from the partner summary", async () => {
    await renderPage();
    expect(headings(2)).toEqual(["Share", "Progress", "Money", "Help", "Recent commission"]);
    const band = screen.getByRole("region", { name: "This month" });
    expect(within(band).getByText("Earned this month").nextSibling).toHaveTextContent("R120");
    expect(within(band).getByText("Next payout").nextSibling).toHaveTextContent("R45");
    expect(screen.getByText("https://verifymzansi.com/?ref=THANDO1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Share on WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/?text=https%3A%2F%2Fverifymzansi.com%2F%3Fref%3DTHANDO1"
    );
    expect(screen.getByRole("link", { name: "Download QR code" })).toHaveAttribute(
      "download",
      "verifymzansi-partner-THANDO1.svg"
    );
    expect(screen.getByText("Eligible", { exact: false })).toBeInTheDocument();
  });
});

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PartnerDashboard } from "@/lib/partners/partner-overview";
import { PartnerOverview } from "./partner-overview";

const NOW = new Date("2026-11-21T08:00:00.000Z");

function partner(overrides: Partial<PartnerDashboard> = {}): PartnerDashboard {
  return {
    code: "THANDO1",
    status: "active",
    rateBps: 2000,
    referrals: 7,
    payingReferrals: 3,
    totals: { PENDING: 12000, APPROVED: 4500, PAID: 30000, REVERSED: 1000 },
    recent: [
      {
        id: "a",
        amountCents: 12000,
        baseCents: 60000,
        status: "PENDING",
        createdAt: "2026-11-20T10:00:00.000Z",
        eligibleAt: "2026-12-20T10:00:00.000Z",
        manual: false,
      },
      {
        id: "b",
        amountCents: 1000,
        baseCents: 5000,
        status: "REVERSED",
        createdAt: "2026-11-02T10:00:00.000Z",
        eligibleAt: "2026-12-02T10:00:00.000Z",
        manual: false,
      },
      {
        id: "c",
        amountCents: 4500,
        baseCents: 22500,
        status: "APPROVED",
        createdAt: "2026-10-01T10:00:00.000Z",
        eligibleAt: "2026-10-31T10:00:00.000Z",
        manual: false,
      },
    ],
    ...overrides,
  };
}

function figure(scope: HTMLElement, name: string) {
  const term = Array.from(scope.querySelectorAll("dt")).find((dt) => dt.textContent === name);
  return term?.nextSibling?.textContent;
}

describe("PartnerOverview", () => {
  it("shows this month's earnings (less reversals) and the approved next payout", () => {
    render(<PartnerOverview partner={partner()} appUrl="https://verifymzansi.com" now={NOW} />);
    const band = screen.getByRole("region", { name: "This month" });
    expect(figure(band, "Earned this month")).toBe("R120");
    expect(figure(band, "Next payout")).toBe("R45");
    expect(within(band).getByText("Includes commission still in its 30-day wait.")).toBeVisible();
  });

  it("shows progress counts and money by stage", () => {
    const { container } = render(
      <PartnerOverview partner={partner()} appUrl="https://verifymzansi.com" now={NOW} />
    );
    expect(figure(container, "Signed up")).toBe("7");
    expect(figure(container, "Paying")).toBe("3");
    expect(figure(container, "Pending")).toBe("R120");
    expect(figure(container, "Approved")).toBe("R45");
    expect(figure(container, "Paid")).toBe("R300");
  });

  it("offers a downloadable QR code of the referral link, drawn on the server", () => {
    render(<PartnerOverview partner={partner()} appUrl="https://verifymzansi.com" now={NOW} />);
    const href = screen.getByRole("link", { name: "Download QR code" }).getAttribute("href") ?? "";
    expect(href.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(href.split(",")[1] ?? "")).toMatch(/^<svg [^>]*>.*<\/svg>$/);
  });

  it("links to the partner rules and contact, and shows no booklet or statements", () => {
    render(<PartnerOverview partner={partner()} appUrl="https://verifymzansi.com" now={NOW} />);
    expect(screen.getByRole("link", { name: "Partner rules" })).toHaveAttribute(
      "href",
      "/terms#partners"
    );
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      "/contact?topic=general_support"
    );
    expect(screen.queryByText(/booklet|statement/i)).not.toBeInTheDocument();
  });

  it("keeps today's recent commission list: each payment's amount and its commission", () => {
    render(<PartnerOverview partner={partner()} appUrl="https://verifymzansi.com" now={NOW} />);
    const list = screen.getByRole("heading", { name: "Recent commission" })
      .nextSibling as HTMLElement;
    const rows = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^R120on R600 · .*Pending/);
    expect(rows[1]).toMatch(/^R10on R50 · .*Reversed/);
    expect(rows[2]).toMatch(/^R45on R225 · .*Approved/);
  });

  it("shows no customer names", () => {
    render(<PartnerOverview partner={partner()} appUrl="https://verifymzansi.com" now={NOW} />);
    expect(screen.queryByRole("heading", { name: "Customers" })).not.toBeInTheDocument();
  });
});

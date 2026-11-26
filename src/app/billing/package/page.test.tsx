import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PackageCheckoutPage from "./page";
import { readFoundationSlotPackageOffer } from "@/lib/foundation/slot-package-offer";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationMySlotPackage } from "@/lib/foundation/billing-runtime";
import { readMyUnpaidIndividualInvoices } from "@/lib/foundation/customer-invoices";

vi.mock("@/lib/foundation/slot-package-offer", () => ({ readFoundationSlotPackageOffer: vi.fn() }));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("@/lib/foundation/billing-runtime", () => ({ readFoundationMySlotPackage: vi.fn() }));
vi.mock("@/lib/foundation/customer-invoices", () => ({
  readMyUnpaidIndividualInvoices: vi.fn(async () => []),
}));
vi.mock("./package-checkout", () => ({
  PackageCheckout: (props: {
    terms: { days: number; planId: string | null }[];
    initialSlots: number;
    initialDays: number;
    block: string | null;
    unpaidInvoices: string[];
    offerUnavailable?: boolean;
  }) => (
    <>
      {props.offerUnavailable ? <p>offer unavailable</p> : null}
      <p>
        {`${props.terms.map((t) => t.days).join("/")} ${props.initialSlots}x${props.initialDays} ${props.block ?? "open"}`}
        {props.unpaidInvoices.length ? ` unpaid ${props.unpaidInvoices.join(",")}` : ""}
      </p>
      <p>{`plans ${props.terms.map((t) => t.planId ?? "none").join(",")}`}</p>
    </>
  ),
}));

const offer = {
  on_sale: true,
  plans: [
    { id: "a", term_days: 30 },
    { id: "b", term_days: 90 },
    { id: "c", term_days: 180 },
  ],
};
const params = (value: Record<string, string>) => ({ searchParams: Promise.resolve(value) });

describe("the package checkout page (P4a)", () => {
  beforeEach(() => {
    vi.mocked(readFoundationSlotPackageOffer).mockReset();
    vi.mocked(readFoundationServerSession).mockResolvedValue({ api: {} } as never);
    vi.mocked(readFoundationMySlotPackage).mockResolvedValue({
      verified: true,
      can_buy: true,
    } as never);
  });

  it("is shown while packages are not on sale, with the three terms and no plan", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue({
      on_sale: false,
      plans: [],
    } as never);
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText("30/90/180 25x30 open")).toBeInTheDocument();
    expect(screen.getByText("plans none,none,none")).toBeInTheDocument();
    expect(screen.queryByText("offer unavailable")).not.toBeInTheDocument();
  });

  it("says the prices could not be loaded when the offer read fails (not 'not on sale')", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockRejectedValue(new Error("unavailable"));
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText("plans none,none,none")).toBeInTheDocument();
    expect(screen.getByText("offer unavailable")).toBeInTheDocument();
  });

  it("passes the plans on sale", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue(offer as never);
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText("plans a,b,c")).toBeInTheDocument();
  });

  it("opens with the size and term from the link, within the rules", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue(offer as never);
    render(await PackageCheckoutPage(params({ slots: "50", days: "90" })));
    expect(screen.getByText("30/90/180 50x90 open")).toBeInTheDocument();
  });

  it("falls back to 25 slots for 30 days for a link outside the rules", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue(offer as never);
    render(await PackageCheckoutPage(params({ slots: "3", days: "60" })));
    expect(screen.getByText("30/90/180 25x30 open")).toBeInTheDocument();
  });

  it.each([
    [{ verified: false, can_buy: false }, "id_review"],
    [{ verified: true, can_buy: false }, "has_package"],
  ])("says why a member cannot buy (%o)", async (mine, block) => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue(offer as never);
    vi.mocked(readFoundationMySlotPackage).mockResolvedValue(mine as never);
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText(`30/90/180 25x30 ${block}`)).toBeInTheDocument();
  });

  it("passes the member's unpaid Individual slot invoices (D6), and none when they cannot be read", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue(offer as never);
    vi.mocked(readMyUnpaidIndividualInvoices).mockResolvedValueOnce(["VM-2026-000187"]);
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText("30/90/180 25x30 open unpaid VM-2026-000187")).toBeInTheDocument();
    vi.mocked(readMyUnpaidIndividualInvoices).mockRejectedValueOnce(new Error("unavailable"));
    render(await PackageCheckoutPage(params({ slots: "10" })));
    expect(screen.getByText("30/90/180 10x30 open")).toBeInTheDocument();
  });

  it("lets a signed-out visitor see the page (they sign in to pay)", async () => {
    vi.mocked(readFoundationSlotPackageOffer).mockResolvedValue(offer as never);
    vi.mocked(readFoundationServerSession).mockRejectedValue(new Error("signed out"));
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText("30/90/180 25x30 open")).toBeInTheDocument();
  });
});

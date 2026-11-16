import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PackageCheckoutPage from "./page";
import { notFound } from "next/navigation";
import { readPackagesOnSale } from "@/lib/foundation/slot-package-offer";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationMySlotPackage } from "@/lib/foundation/billing-runtime";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/foundation/slot-package-offer", () => ({ readPackagesOnSale: vi.fn() }));
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("@/lib/foundation/billing-runtime", () => ({ readFoundationMySlotPackage: vi.fn() }));
vi.mock("./package-checkout", () => ({
  PackageCheckout: (props: {
    terms: { days: number }[];
    initialSlots: number;
    initialDays: number;
    block: string | null;
  }) => (
    <p>{`${props.terms.map((t) => t.days).join("/")} ${props.initialSlots}x${props.initialDays} ${props.block ?? "open"}`}</p>
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
    vi.mocked(readPackagesOnSale).mockReset();
    vi.mocked(readFoundationServerSession).mockResolvedValue({ api: {} } as never);
    vi.mocked(readFoundationMySlotPackage).mockResolvedValue({
      verified: true,
      can_buy: true,
    } as never);
  });

  it("is not found while packages are not on sale", async () => {
    vi.mocked(readPackagesOnSale).mockResolvedValue(null);
    await expect(PackageCheckoutPage(params({}))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("opens with the size and term from the link, within the rules", async () => {
    vi.mocked(readPackagesOnSale).mockResolvedValue(offer as never);
    render(await PackageCheckoutPage(params({ slots: "50", days: "90" })));
    expect(screen.getByText("30/90/180 50x90 open")).toBeInTheDocument();
  });

  it("falls back to 25 slots for 30 days for a link outside the rules", async () => {
    vi.mocked(readPackagesOnSale).mockResolvedValue(offer as never);
    render(await PackageCheckoutPage(params({ slots: "3", days: "60" })));
    expect(screen.getByText("30/90/180 25x30 open")).toBeInTheDocument();
  });

  it.each([
    [{ verified: false, can_buy: false }, "id_review"],
    [{ verified: true, can_buy: false }, "has_package"],
  ])("says why a member cannot buy (%o)", async (mine, block) => {
    vi.mocked(readPackagesOnSale).mockResolvedValue(offer as never);
    vi.mocked(readFoundationMySlotPackage).mockResolvedValue(mine as never);
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText(`30/90/180 25x30 ${block}`)).toBeInTheDocument();
  });

  it("lets a signed-out visitor see the page (they sign in to pay)", async () => {
    vi.mocked(readPackagesOnSale).mockResolvedValue(offer as never);
    vi.mocked(readFoundationServerSession).mockRejectedValue(new Error("signed out"));
    render(await PackageCheckoutPage(params({})));
    expect(screen.getByText("30/90/180 25x30 open")).toBeInTheDocument();
  });
});

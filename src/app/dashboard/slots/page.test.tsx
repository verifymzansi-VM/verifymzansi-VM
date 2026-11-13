import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MySlotsPage from "./page";
import { redirect } from "next/navigation";
import {
  FoundationServerSessionError,
  readFoundationServerSession,
} from "@/lib/foundation/server-session";
import { FoundationBillingError, readFoundationMySlots } from "@/lib/foundation/billing-runtime";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(),
  FoundationServerSessionError: class extends Error {
    constructor(readonly status: number) {
      super(`session ${status}`);
    }
  },
}));
vi.mock("@/lib/foundation/billing-runtime", () => ({
  readFoundationMySlots: vi.fn(),
  FoundationBillingError: class extends Error {
    constructor(readonly status: number) {
      super(`billing ${status}`);
    }
  },
}));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: vi.fn() }));
vi.mock("@/lib/foundation/billing-catalogue", () => ({
  readFoundationBillingCatalogue: vi.fn(async () => ({ plans: [] })),
  individualSlotPlans: vi.fn(() => []),
}));
vi.mock("@/components/billing/my-slots", () => ({
  MySlots: ({ slots }: { slots: unknown[] }) => <p>{`${slots.length} slots`}</p>,
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const Session = FoundationServerSessionError as unknown as new (status: number) => Error;
const Billing = FoundationBillingError as unknown as new (status: number) => Error;

describe("My slots page", () => {
  beforeEach(() => {
    vi.mocked(readFoundationServerSession).mockReset();
    vi.mocked(readFoundationMySlots).mockReset();
    vi.mocked(redirect).mockClear();
  });

  it("shows the member's slots", async () => {
    vi.mocked(readFoundationServerSession).mockResolvedValue({ api: {} } as never);
    vi.mocked(readFoundationMySlots).mockResolvedValue({
      slots: [{}, {}],
      individual: {},
    } as never);
    render(await MySlotsPage());
    expect(screen.getByText("2 slots")).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in", async () => {
    vi.mocked(readFoundationServerSession).mockRejectedValue(new Session(401));
    await expect(MySlotsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("does not hide a refused account or command behind the outage message", async () => {
    vi.mocked(readFoundationServerSession).mockRejectedValue(new Session(403));
    await expect(MySlotsPage()).rejects.toThrow("session 403");
    vi.mocked(readFoundationServerSession).mockResolvedValue({ api: {} } as never);
    vi.mocked(readFoundationMySlots).mockRejectedValue(new Billing(403));
    await expect(MySlotsPage()).rejects.toThrow("billing 403");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("says the slots cannot be shown during an outage", async () => {
    vi.mocked(readFoundationServerSession).mockResolvedValue({ api: {} } as never);
    vi.mocked(readFoundationMySlots).mockRejectedValue(new Billing(503));
    render(await MySlotsPage());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your slots cannot be shown right now. Please try again in a few minutes."
    );
  });
});

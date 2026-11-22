import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import FreeCreditsPage from "./page";

const { readFreeCredits, redirectMock } = vi.hoisted(() => ({
  readFreeCredits: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api: { rpc: vi.fn() } })),
}));
vi.mock("@/lib/foundation/free-credits", () => ({ readFreeCredits }));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

describe("FreeCreditsPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    readFreeCredits.mockResolvedValue([]);
  });

  it("needs free_credit:view (admins only)", async () => {
    render(await FreeCreditsPage());
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("free_credit:view");
  });

  it("shows the header, the give form and the empty list", async () => {
    render(await FreeCreditsPage());
    expect(screen.getByRole("heading", { level: 1, name: "Free credits" })).toBeVisible();
    expect(screen.getByText(/Never charged, never renewed\./)).toBeVisible();
    expect(screen.getByRole("button", { name: "Give" })).toBeEnabled();
    expect(screen.getByText("No free credits yet")).toBeVisible();
  });

  it("sends staff to verify their authenticator again, then back here", async () => {
    readFreeCredits.mockRejectedValue(new FoundationStaffCommandError(403, "Verify again", true));
    await expect(FreeCreditsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/staff/two-step?next=%2Fadmin%2Ffree-credits");
  });

  it("does not claim an empty list when the read fails", async () => {
    readFreeCredits.mockRejectedValue(new Error("down"));
    render(await FreeCreditsPage());
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No free credits yet")).toBeNull();
  });
});

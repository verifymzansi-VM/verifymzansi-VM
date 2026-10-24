import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountSecurityPage from "./page";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error("redirect:" + path);
  },
}));
vi.mock("@/lib/foundation/server-session", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationServerSession: vi.fn(),
}));
vi.mock("@/app/staff/two-step/two-step-client", () => ({
  StaffTwoStepClient: ({ friendlyName }: { friendlyName: string }) => <p>{friendlyName}</p>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFoundationServerSession).mockResolvedValue({
    account: {
      account_id: "00000000-0000-4000-8000-000000000001",
      staff: null,
      totp_enrolled: false,
    },
  } as Awaited<ReturnType<typeof readFoundationServerSession>>);
});
it("lets a fresh ordinary account set up its own authenticator before any staff assignment", async () => {
  render(await AccountSecurityPage());
  expect(screen.getByRole("heading", { name: "Account security" })).toBeInTheDocument();
  expect(screen.getByText("VerifyMzansi account")).toBeInTheDocument();
});
it.each([
  [401, "/login?returnUrl=%2Fdashboard%2Fsecurity"],
  [403, "/error?reason=forbidden"],
  [503, "/error?reason=unavailable"],
] as const)("refuses an unavailable or unverified session %s", async (status, path) => {
  vi.mocked(readFoundationServerSession).mockRejectedValue(
    new FoundationServerSessionError(status)
  );
  await expect(AccountSecurityPage()).rejects.toThrow("redirect:" + path);
});

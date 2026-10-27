import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";
const { session, legacy } = vi.hoisted(() => ({ session: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: legacy }));
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: session }));
vi.mock("@/components/dashboard/communication-hub", () => ({
  CommunicationHub: () => <p>Native notifications</p>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({});
});
it("requires the canonical account session before rendering notifications", async () => {
  render(await Page());
  expect(session).toHaveBeenCalledTimes(1);
  expect(legacy).not.toHaveBeenCalled();
  expect(screen.getByText("Native notifications")).toBeInTheDocument();
});
it("does not fall back to source Auth on a native session refusal", async () => {
  session.mockRejectedValue(new Error("Session denied"));
  await expect(Page()).rejects.toThrow("Session denied");
  expect(legacy).not.toHaveBeenCalled();
});

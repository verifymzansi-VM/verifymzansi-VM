import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FoundationModerationQueue } from "./moderation-queue";

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  account: "reviewer-one",
  assigned: ["queue:claim", "post:moderate", "report:resolve"],
  loading: false,
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (select: (state: object) => unknown) =>
    select({
      isLoading: fixture.loading,
      user: { id: fixture.account },
      foundationContext: {
        account_id: fixture.account,
        staff: { can_access: true, assigned_capabilities: fixture.assigned },
      },
    }),
}));
vi.mock("@/lib/foundation/browser-client", () => ({
  getFoundationBrowserClient: () => ({ rpc: fixture.rpc }),
}));
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  fixture.account = "reviewer-one";
  fixture.assigned = ["queue:claim", "post:moderate", "report:resolve"];
  fixture.loading = false;
  fixture.rpc.mockReset().mockImplementation(async (name) => ({
    data:
      name === "my_queue_claims"
        ? [
            {
              subject: "post",
              id,
              claim_generation: "1",
              claim_nonce: id,
              claim_expires_at: "2026-10-27T10:00:00Z",
            },
          ]
        : {
            id,
            revision: 1,
            title: "Private pending post",
            description: "Pending review body",
            kind: "listing",
            area: "market",
            category: "electronics",
            locality: "Synthetic place",
            price_mode: "free",
            price_cents: "0",
            attributes: null,
            media: [],
          },
    error: null,
  }));
});
it("does not read claims without the matching native assignment", () => {
  fixture.assigned = ["queue:claim"];
  render(<FoundationModerationQueue mode="content" />);
  expect(screen.getByRole("alert")).toHaveTextContent("current moderation assignment");
  expect(fixture.rpc).not.toHaveBeenCalled();
});
it("clears private review state when a different account replaces the reviewer", async () => {
  const view = render(<FoundationModerationQueue mode="content" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review item 1" }));
  await screen.findByText("Private pending post");
  fixture.account = "reviewer-two";
  view.rerender(<FoundationModerationQueue mode="content" />);
  expect(screen.queryByText("Private pending post")).not.toBeInTheDocument();
});
it("unmounts pending content immediately if the current reviewer loses permission", async () => {
  const view = render(<FoundationModerationQueue mode="content" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review item 1" }));
  await screen.findByText("Private pending post");
  fixture.assigned = [];
  view.rerender(<FoundationModerationQueue mode="content" />);
  expect(screen.queryByText("Private pending post")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

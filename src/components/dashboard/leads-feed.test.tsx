import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { LeadsFeed } from "./leads-feed";
import { useRealtime } from "@/hooks/use-realtime";
vi.mock("@/hooks/use-realtime", () => ({ useRealtime: vi.fn() }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));
const lead = {
  id: "lead-1",
  target_id: "post-1",
  target_type: "promotion",
  message: "Please send the event details.",
  status: "new",
  buyer_name: "Buyer",
  buyer_email: "buyer@example.com",
  buyer_phone: "0821234567",
  created_at: new Date().toISOString(),
  listings: { title: "Community event" },
};
describe("seller enquiry inbox", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("offers replies to the buyer with the correct event context", () => {
    render(<LeadsFeed initialLeads={[lead]} ownerColumn="owner_id" ownerId="owner" />);
    expect(screen.getByRole("link", { name: /Reply by email/ }).getAttribute("href")).toContain(
      "buyer%40example.com"
    );
    const href = screen.getByRole("link", { name: "Reply on WhatsApp" }).getAttribute("href")!;
    expect(href).toContain("wa.me/27821234567");
    expect(decodeURIComponent(href)).toContain("thanks for your enquiry about Community event");
    expect(decodeURIComponent(href)).toContain("/tourism-events/post-1");
  });
  it("settles an uncertain native status update by reading, without replaying the mutation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ accountId: "owner", leads: [{ ...lead, status: "read" }] }),
      } as Response);
    render(<LeadsFeed initialLeads={[lead]} ownerColumn="owner_id" ownerId="owner" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });
  it("ignores out-of-order private refreshes and does not consume row data from the signal", async () => {
    let first: ((r: Response) => void) | undefined, second: ((r: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          first = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          second = resolve;
        })
      );
    render(<LeadsFeed initialLeads={[lead]} ownerColumn="owner_id" ownerId="owner" />);
    const signal = vi.mocked(useRealtime).mock.calls.at(-1)![0].onEvent;
    act(() => {
      signal({ eventType: "REVALIDATE", new: { message: "Untrusted signal text" } });
      signal({ eventType: "REVALIDATE" });
    });
    await act(async () => {
      second?.({
        ok: true,
        json: async () => ({
          accountId: "owner",
          leads: [{ ...lead, message: "Latest server message" }],
        }),
      } as Response);
    });
    await screen.findByText("Latest server message");
    await act(async () => {
      first?.({
        ok: true,
        json: async () => ({
          accountId: "owner",
          leads: [{ ...lead, message: "Stale server message" }],
        }),
      } as Response);
    });
    expect(screen.queryByText("Stale server message")).not.toBeInTheDocument();
    expect(screen.queryByText("Untrusted signal text")).not.toBeInTheDocument();
  });
});

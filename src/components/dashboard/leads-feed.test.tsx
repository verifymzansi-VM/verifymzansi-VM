import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LeadsFeed } from "./leads-feed";
vi.mock("@/hooks/use-realtime", () => ({ useRealtime: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
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
  it("offers replies to the buyer with the correct event context", () => {
    render(<LeadsFeed initialLeads={[lead]} ownerColumn="owner_id" ownerId="owner" />);
    expect(screen.getByRole("link", { name: "Reply by email" }).getAttribute("href")).toContain(
      "buyer%40example.com"
    );
    const href = screen.getByRole("link", { name: "Reply on WhatsApp" }).getAttribute("href")!;
    expect(href).toContain("wa.me/27821234567");
    expect(decodeURIComponent(href)).toContain("thanks for your enquiry about Community event");
    expect(decodeURIComponent(href)).toContain("/tourism-events/post-1");
  });
  it("restores status and reports network failures", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
    render(<LeadsFeed initialLeads={[lead]} ownerColumn="owner_id" ownerId="owner" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not update"));
    expect(screen.getByRole("button", { name: "Mark as read" })).toBeInTheDocument();
    fetchMock.mockRestore();
  });
});

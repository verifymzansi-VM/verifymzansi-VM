import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionOfferCard } from "./extension-offer-card";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const offer = {
  id: "11111111-1111-4111-8111-111111111111",
  target_label: "Founding pilot — Richards Bay",
  days: 14,
  current_ends_at: "2026-12-30T08:00:00.000Z",
  proposed_ends_at: "2027-01-13T08:00:00.000Z",
  respond_by: "2026-12-23T08:00:00.000Z",
};

describe("ExtensionOfferCard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("states both end dates and that nothing is charged", () => {
    render(<ExtensionOfferCard offer={offer} />);
    expect(screen.getByRole("heading", { name: "Trial extension offered" })).toBeInTheDocument();
    expect(screen.getByText("14 days")).toBeInTheDocument();
    expect(screen.getByText("Current end")).toBeInTheDocument();
    expect(screen.getByText("New end if you accept")).toBeInTheDocument();
    expect(
      screen.getByText("Accepting does not create any payment or automatic renewal.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Respond by 23 Dec 2026/)).toBeInTheDocument();
  });

  it("posts the decision for this offer only", async () => {
    render(<ExtensionOfferCard offer={offer} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept extension" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/trial-extensions/${offer.id}`);
    expect(JSON.parse(String(init.body))).toEqual({ decision: "accept" });
    expect(screen.getByRole("status")).toHaveTextContent("Extension accepted");
  });

  it("is read-only for administrators who are not the owner", () => {
    render(<ExtensionOfferCard offer={offer} canRespond={false} />);
    expect(screen.queryByRole("button", { name: "Accept extension" })).toBeNull();
    expect(screen.getByText(/Waiting for the programme owner/)).toBeInTheDocument();
  });
});

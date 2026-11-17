import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast, fetchStaff } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: vi.fn(),
  fetchStaff: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/auth/staff-evidence-fetch", () => ({ fetchStaffEvidence: fetchStaff }));

import { SamplePostsClient, type StaffSampleRow } from "./sample-posts-client";

const samples: StaffSampleRow[] = [
  {
    slug: "fish-braai",
    title: "Fish braai on the beach",
    area: "event",
    place: "Durban, KwaZulu-Natal",
    posterUrl: "/sample-posts-local/fish.webp",
  },
  {
    slug: "guest-house",
    title: "Guest house by the lagoon",
    area: "tourism",
    place: "Knysna, Western Cape",
    posterUrl: "/sample-posts-local/house.webp",
  },
];

describe("staff sample posts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every sample with its thumbnail, area and state", () => {
    const { container } = render(
      <SamplePostsClient samples={samples} initialHidden={["guest-house"]} switchedOn />
    );
    expect(screen.getByText("Fish braai on the beach")).toBeInTheDocument();
    expect(
      screen.getByText("Events · Tourism & Events · Durban, KwaZulu-Natal")
    ).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove Fish braai on the beach" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore Guest house by the lagoon" })).toBeEnabled();
    expect(screen.getByText("Shown")).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
  });

  it("removes a sample through the staff route and shows it removed", async () => {
    fetchStaff.mockResolvedValue(
      new Response(JSON.stringify({ success: true, sample: { slug: "fish-braai", hidden: true } }))
    );
    render(<SamplePostsClient samples={samples} initialHidden={[]} switchedOn />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Fish braai on the beach" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore Fish braai on the beach" })).toBeEnabled()
    );
    const [url, init] = fetchStaff.mock.calls[0];
    expect(url).toBe("/api/admin/sample-posts");
    expect(JSON.parse(init.body)).toEqual({ slug: "fish-braai", hidden: true });
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the state and explains a refusal", async () => {
    fetchStaff.mockResolvedValue(
      new Response(JSON.stringify({ error: "Your staff access changed. Reload the page." }), {
        status: 403,
      })
    );
    render(<SamplePostsClient samples={samples} initialHidden={[]} switchedOn />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Fish braai on the beach" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Your staff access changed. Reload the page." })
      )
    );
    expect(screen.getByRole("button", { name: "Remove Fish braai on the beach" })).toBeEnabled();
  });

  it("disables the buttons when the removed list could not be read", () => {
    render(<SamplePostsClient samples={samples} initialHidden={null} switchedOn={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
    expect(screen.getByText(/Samples are off on this site/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});

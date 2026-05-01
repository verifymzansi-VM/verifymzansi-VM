import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModerationQueueClient } from "./moderation-queue-client";
import type { ModerationItem } from "./moderation-preview-panel";

const mockRefresh = vi.fn();
const mockWithCsrfHeaders = vi.fn((headers?: HeadersInit) => {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("x-csrf-token", "a".repeat(64));
  return nextHeaders;
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@/lib/utils/media-url", () => ({
  normalizeMediaUrl: (value: string) => value,
}));

vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (headers?: HeadersInit) => mockWithCsrfHeaders(headers),
}));

vi.mock("./moderation-preview-panel", () => ({
  ModerationPreviewPanel: ({ item }: { item: { title?: string } }) => (
    <div>preview:{item.title}</div>
  ),
}));

const items: ModerationItem[] = [
  {
    id: "listing-1",
    title: "Used iPhone 15",
    status: "pending_moderation",
    created_at: "2026-03-20T08:00:00.000Z",
    category: "electronics",
    owner_id: "user-1",
    area: "MZANSI_MARKET",
    areaLabel: "Mzansi Market",
    itemType: "Listing",
    photos: ["https://example.com/listing.jpg"],
  },
  {
    id: "business-1",
    title: "Nomsa Beauty Studio",
    status: "pending_moderation",
    created_at: "2026-03-20T09:00:00.000Z",
    owner_id: "user-2",
    area: "MZANSI_BUSINESS",
    areaLabel: "Mzansi Business",
    itemType: "Business",
  },
  {
    id: "promotion-1",
    title: "Weekend Sale",
    status: "pending_moderation",
    created_at: "2026-03-20T10:00:00.000Z",
    owner_id: "user-3",
    area: "PROMOTIONS_EVENTS",
    areaLabel: "Tourism & Events",
    itemType: "Promotion",
  },
  {
    id: "edit-1",
    targetId: "listing-1",
    title: "Used iPhone 15 - updated",
    status: "pending",
    created_at: "2026-03-20T11:00:00.000Z",
    owner_id: "user-1",
    area: "MZANSI_MARKET",
    areaLabel: "Mzansi Market",
    itemType: "Listing edit",
    isEditRequest: true,
    current_snapshot: { title: "Used iPhone 15" },
    change_summary: [
      {
        field: "title",
        label: "Title",
        before: "Used iPhone 15",
        after: "Used iPhone 15 - updated",
      },
      {
        field: "price_cents",
        label: "Price",
        before: "1200000",
        after: "1100000",
      },
    ],
  },
];

describe("ModerationQueueClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })
    );
  });

  it("filters moderation items by area", () => {
    render(<ModerationQueueClient items={items} />);

    fireEvent.click(screen.getByRole("button", { name: /Mzansi Business \(1\)/i }));

    expect(screen.getByText("Nomsa Beauty Studio")).toBeInTheDocument();
    expect(screen.queryByText("Used iPhone 15")).not.toBeInTheDocument();
    expect(screen.queryByText("Weekend Sale")).not.toBeInTheDocument();
  });

  it("requires a rejection reason before submitting", async () => {
    render(<ModerationQueueClient items={items} />);

    fireEvent.click(screen.getAllByRole("button", { name: /reject/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Reject$/i }));

    expect(await screen.findByText(/please provide a rejection reason/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits approve and reject decisions with the exact moderation payload", async () => {
    render(<ModerationQueueClient items={items} />);

    fireEvent.click(screen.getAllByRole("button", { name: /approve/i })[2]);
    fireEvent.click(screen.getByRole("button", { name: /^Publish$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        "/api/admin/content/decide",
        expect.objectContaining({
          method: "POST",
          headers: expect.any(Headers),
          body: JSON.stringify({
            itemId: "promotion-1",
            area: "PROMOTIONS_EVENTS",
            decision: "approve",
            reason: undefined,
          }),
        })
      );
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockWithCsrfHeaders).toHaveBeenNthCalledWith(1, {
      "Content-Type": "application/json",
    });

    fireEvent.click(screen.getAllByRole("button", { name: /reject/i })[1]);
    fireEvent.change(screen.getByLabelText(/rejection reason/i), {
      target: { value: "Missing operating hours" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Reject$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        "/api/admin/content/decide",
        expect.objectContaining({
          method: "POST",
          headers: expect.any(Headers),
          body: JSON.stringify({
            itemId: "business-1",
            area: "MZANSI_BUSINESS",
            decision: "reject",
            reason: "Missing operating hours",
          }),
        })
      );
    });

    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(mockWithCsrfHeaders).toHaveBeenNthCalledWith(2, {
      "Content-Type": "application/json",
    });
  });

  it("submits edit review decisions to the content edit endpoint", async () => {
    render(<ModerationQueueClient items={items} />);

    fireEvent.click(screen.getAllByRole("button", { name: /approve/i })[3]);
    fireEvent.click(screen.getByRole("button", { name: /^Publish$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/content-edits/decide",
        expect.objectContaining({
          method: "POST",
          headers: expect.any(Headers),
          body: JSON.stringify({
            requestId: "edit-1",
            decision: "approve",
            reason: undefined,
          }),
        })
      );
    });
  });

  it("surfaces changed fields on edit request cards", () => {
    render(<ModerationQueueClient items={items} />);

    expect(screen.getByText("2 changed")).toBeInTheDocument();
    expect(screen.getByText("Updates: Title, Price")).toBeInTheDocument();
  });

  it("uses a horizontally scrollable preview wrapper in the review sheet", () => {
    render(<ModerationQueueClient items={items} />);

    fireEvent.click(screen.getAllByRole("button", { name: /review/i })[0]);

    const previewNode = screen.getByText("preview:Used iPhone 15");
    const wrapper = previewNode.parentElement;

    expect(wrapper).toHaveClass("overflow-x-auto");
    expect(wrapper).not.toHaveClass("overflow-hidden");
  });

  it("keeps the moderation action row width-constrained so buttons stay visible", () => {
    render(<ModerationQueueClient items={items} />);

    const reviewButton = screen.getAllByRole("button", { name: /review/i })[0];
    const actionRow = reviewButton.parentElement;

    expect(actionRow).toHaveClass("min-w-0");
    expect(actionRow).toHaveClass("w-full");
    expect(actionRow).toHaveClass("max-w-full");
    expect(actionRow).toHaveClass("justify-start");
    expect(actionRow).toHaveClass("lg:justify-end");
  });
});

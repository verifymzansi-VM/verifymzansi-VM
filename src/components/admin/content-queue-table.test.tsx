import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentQueueTable } from "./content-queue-table";
import { toContentEditModerationItem } from "@/lib/content-edit-moderation";

vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

afterEach(() => vi.unstubAllGlobals());

const edit = toContentEditModerationItem({
  id: "edit-request-id",
  target_id: "live-post-id",
  target_type: "business",
  owner_id: "owner",
  area: "MZANSI_BUSINESS",
  status: "pending",
  created_at: "2026-09-12T12:00:00Z",
  current_snapshot: { business_name: "My business", description: "Old description" },
  proposed_data: { business_name: "My business", description: "New description" },
});

describe("area content edit review", () => {
  it("shows both current and proposed details", () => {
    render(<ContentQueueTable items={[edit]} area="MZANSI_BUSINESS" />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("Current: Old description")).toBeInTheDocument();
    expect(screen.getByText("Proposed: New description")).toBeInTheDocument();
  });

  it.each(["approve", "reject"] as const)(
    "sends %s to the edit decision endpoint using the request ID",
    async (decision) => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      const complete = vi.fn();
      render(
        <ContentQueueTable items={[edit]} area="MZANSI_BUSINESS" onDecisionComplete={complete} />
      );
      fireEvent.click(
        screen.getByRole("button", { name: decision === "approve" ? "Approve" : "Reject" })
      );
      const dialog = screen.getByRole("dialog");
      if (decision === "reject")
        fireEvent.change(within(dialog).getByRole("textbox"), {
          target: { value: "Incorrect details" },
        });
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: decision === "approve" ? "Confirm Approve" : "Confirm Reject",
        })
      );
      await waitFor(() => expect(complete).toHaveBeenCalledOnce());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/content-edits/decide",
        expect.objectContaining({
          body: JSON.stringify({
            requestId: "edit-request-id",
            decision,
            ...(decision === "reject" ? { reason: "Incorrect details" } : {}),
          }),
        })
      );
    }
  );
});

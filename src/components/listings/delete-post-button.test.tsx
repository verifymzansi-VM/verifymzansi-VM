import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeletePostButton } from "./delete-post-button";

const refresh = vi.fn();
const toast = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

describe("DeletePostButton", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("warns that a delete can't be undone and confirms it afterwards", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DeletePostButton
        itemId="post-1"
        area="MZANSI_MARKET"
        expectedRevision={3}
        contentType="listing"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("This can't be undone.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Post deleted" }))
    );
    expect(refresh).toHaveBeenCalled();
  });
});

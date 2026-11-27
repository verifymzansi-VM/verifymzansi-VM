import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResubmitButton } from "./resubmit-button";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-post-action-fields", () => ({
  usePostActionFields: () => () => ({}),
}));

const refuse = (body: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 409, json: async () => body }))
  );

describe("ResubmitButton", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("links to the post's Edit page when the current posting terms must be accepted first", async () => {
    refuse({
      error: "Review and accept the current posting terms before continuing",
      reason: "posting_terms_required",
    });
    render(<ResubmitButton itemId="p1" area="MZANSI_MARKET" editHref="/post/edit-listing/p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resubmit for review" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Review and accept the current posting terms before continuing. Open Edit to accept them"
    );
    expect(screen.getByRole("link", { name: "Open Edit to accept them" })).toHaveAttribute(
      "href",
      "/post/edit-listing/p1"
    );
  });

  it("shows any other refusal without the link", async () => {
    refuse({
      error: "Your post or posting allowance changed. Reload your posts before continuing.",
      reason: "post_changed",
    });
    render(<ResubmitButton itemId="p1" area="MZANSI_MARKET" editHref="/post/edit-listing/p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resubmit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Reload your posts/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

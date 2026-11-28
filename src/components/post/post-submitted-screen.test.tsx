import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostSubmittedScreen } from "./post-submitted-screen";

describe("PostSubmittedScreen", () => {
  it("says the post is submitted and links to it, shown In review", () => {
    render(<PostSubmittedScreen postTitle="Red jacket" area="MZANSI_MARKET" />);
    expect(screen.getByRole("heading", { name: "Submitted" })).toHaveFocus();
    expect(
      screen.getByText("Our team reviews every post before it goes live.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Red jacket\s*In review/ })).toHaveAttribute(
      "href",
      "/dashboard/listings?area=MZANSI_MARKET"
    );
    expect(screen.getByRole("link", { name: "Create another post" })).toHaveAttribute(
      "href",
      "/post/create"
    );
  });
});

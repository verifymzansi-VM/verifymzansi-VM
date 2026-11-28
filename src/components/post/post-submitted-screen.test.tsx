import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostSubmittedScreen, createdPostId } from "./post-submitted-screen";

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

  it("links to the new post's card in My posts", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    render(<PostSubmittedScreen postTitle="Red jacket" area="MZANSI_MARKET" postId={id} />);
    expect(screen.getByRole("link", { name: /Red jacket\s*In review/ })).toHaveAttribute(
      "href",
      `/dashboard/listings?area=MZANSI_MARKET#post-${id}`
    );
  });

  it("reads the new post's id from a copy of the create answer", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const response = new Response(JSON.stringify({ success: true, id }));
    await expect(createdPostId(response)).resolves.toBe(id);
    await expect(response.json()).resolves.toMatchObject({ id });
    await expect(createdPostId(new Response("not json"))).resolves.toBeNull();
  });
});

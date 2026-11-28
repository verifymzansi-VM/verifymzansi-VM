import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostLinks, postLinkItems } from "./post-links";

describe("PostLinks", () => {
  it("shows each filled link as a tappable link, YouTube included", () => {
    render(
      <PostLinks
        website="www.example.co.za"
        social={{ youtube: "https://youtube.com/@shop", facebook: "", instagram: undefined }}
      />
    );
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute(
      "href",
      "https://www.example.co.za"
    );
    expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute(
      "href",
      "https://youtube.com/@shop"
    );
    expect(screen.queryByRole("link", { name: "Facebook" })).toBeNull();
  });

  it("drops unsafe links and renders nothing without links", () => {
    expect(postLinkItems("javascript:alert(1)", null)).toEqual([]);
    const { container } = render(<PostLinks website={null} social={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

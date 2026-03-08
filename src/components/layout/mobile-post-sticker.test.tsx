/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobilePostSticker } from "./mobile-post-sticker";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("MobilePostSticker", () => {
  it("renders a persistent Post+ link to the create post page on all breakpoints", () => {
    const { container } = render(<MobilePostSticker />);

    expect(screen.getByRole("link", { name: "Post+" })).toHaveAttribute("href", "/post/create");
    expect(container.firstChild).not.toHaveClass("md:hidden");
  });
});

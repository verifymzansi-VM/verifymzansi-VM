/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobilePostSticker } from "./mobile-post-sticker";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(() => "/"),
}));

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
  usePathname: usePathnameMock,
}));

describe("MobilePostSticker", () => {
  it("renders a persistent Post+ link to the create post page on all breakpoints", () => {
    usePathnameMock.mockReturnValue("/");
    const { container } = render(<MobilePostSticker />);

    expect(screen.getByRole("link", { name: "Post+" })).toHaveAttribute("href", "/post/create");
    expect(container.firstChild).not.toHaveClass("md:hidden");
  });

  it("hides the sticker on marketplace browse pages with filter actions", () => {
    usePathnameMock.mockReturnValue("/promotions");
    const { container } = render(<MobilePostSticker />);

    expect(container.firstChild).toBeNull();
  });
});

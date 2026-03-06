import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CreatePostPage from "./page";

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

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer">Footer</footer>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

describe("CreatePostPage", () => {
  it("renders exactly three create cards with expected labels", () => {
    render(<CreatePostPage />);

    expect(screen.getAllByText("Mzansi Market").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mzansi Business").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Promotions & Events").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("renders the posting guide copy", () => {
    render(<CreatePostPage />);

    expect(screen.getByText("How posting works")).toBeInTheDocument();
    expect(
      screen.getByText("Pick your area, complete the guided form, and submit your post for review.")
    ).toBeInTheDocument();
  });
});

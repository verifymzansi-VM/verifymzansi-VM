import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdvertisePage from "./page";

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
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer" />,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}));

describe("AdvertisePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders public advertising CTAs and guidance", () => {
    render(<AdvertisePage />);

    expect(
      screen.getByText(/Put your next campaign in front of South Africans/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start advertising/i })).toHaveAttribute(
      "href",
      "/post/create-promotion"
    );
    expect(screen.getByRole("link", { name: /See pricing and plans/i })).toHaveAttribute(
      "href",
      "/pricing"
    );
    expect(
      screen.getByText(/You'll be prompted to sign in and complete verification/i)
    ).toBeInTheDocument();
  });
});

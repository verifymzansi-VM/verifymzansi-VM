import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CreatePostPage from "./page";
import { useAuth } from "@/hooks/use-auth";

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

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
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
  it("renders exactly three category cards with the current category selection UI", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: true,
      profile: { account_verification_status: "verified" },
    });

    render(<CreatePostPage />);

    expect(screen.getAllByText("Mzansi Market").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mzansi Business").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Promotions & Events").length).toBeGreaterThan(0);
    expect(screen.getByText("Choose What to Post")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick the area that fits your goal: a listing, a business profile, or a Promotions & Events campaign."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Sell, buy, or rent a single item.")).toBeInTheDocument();
    expect(screen.getByText("Create your full business profile.")).toBeInTheDocument();
    expect(
      screen.getByText("Run a time-sensitive campaign for your business.")
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("sends verified users directly to the create forms", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: true,
      profile: { account_verification_status: "verified" },
    });

    render(<CreatePostPage />);

    expect(screen.getByRole("link", { name: /Mzansi Market/i })).toHaveAttribute(
      "href",
      "/post/create-listing"
    );
    expect(screen.getByRole("link", { name: /Mzansi Business/i })).toHaveAttribute(
      "href",
      "/post/create-business"
    );
    expect(screen.getByRole("link", { name: /Promotions & Events/i })).toHaveAttribute(
      "href",
      "/post/create-promotion"
    );
  });

  it("sends unverified users to verification with a returnUrl", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: false,
      profile: { account_verification_status: "incomplete" },
    });

    render(<CreatePostPage />);

    expect(screen.getByText("Verification required before posting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mzansi Market/i }).getAttribute("href")).toContain(
      "/verification?returnUrl=%2Fpost%2Fcreate-listing"
    );
    expect(screen.getByRole("link", { name: /Mzansi Business/i }).getAttribute("href")).toContain(
      "/verification?returnUrl=%2Fpost%2Fcreate-business"
    );
    expect(
      screen.getByRole("link", { name: /Promotions & Events/i }).getAttribute("href")
    ).toContain("/verification?returnUrl=%2Fpost%2Fcreate-promotion");
  });
});

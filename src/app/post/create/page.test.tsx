import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accountVerificationStatus: "verified" }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders exactly three category cards with the current category selection UI", () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: true,
      isAuthenticated: true,
      profile: { account_verification_status: "verified" },
      refresh: vi.fn(),
    });

    render(<CreatePostPage />);

    expect(screen.getAllByText("Mzansi Market").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mzansi Business").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Promotions & Events").length).toBeGreaterThan(0);
    expect(screen.getByText("Pick a category to start posting.")).toBeInTheDocument();
    expect(screen.getByText("Sell, buy, or rent a single item.")).toBeInTheDocument();
    expect(screen.getByText("Create your full business profile.")).toBeInTheDocument();
    expect(screen.getByText("Promote something time-sensitive.")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("sends verified users directly to the create forms", async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: true,
      isAuthenticated: true,
      profile: { account_verification_status: "verified" },
      refresh: vi.fn(),
    });

    render(<CreatePostPage />);

    await waitFor(() => {
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
  });

  it("sends unverified users to verification with a returnUrl", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accountVerificationStatus: "incomplete" }),
    }) as unknown as typeof fetch;

    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: false,
      isAuthenticated: true,
      profile: { account_verification_status: "incomplete" },
      refresh: vi.fn(),
    });

    render(<CreatePostPage />);

    await waitFor(() => {
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

  it("promotes stale verified profiles once the reconciled verification status loads", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accountVerificationStatus: "verified" }),
    }) as unknown as typeof fetch;

    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: false,
      isAuthenticated: true,
      profile: { account_verification_status: "incomplete" },
      refresh: vi.fn(),
    });

    render(<CreatePostPage />);

    await waitFor(() => {
      expect(screen.queryByText("Verification required before posting")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Mzansi Market/i })).toHaveAttribute(
        "href",
        "/post/create-listing"
      );
    });
  });

  it("does not flash the verification banner while stale authenticated profiles are being reconciled", () => {
    global.fetch = vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch;

    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isVerified: false,
      isAuthenticated: true,
      profile: { account_verification_status: "incomplete" },
      refresh: vi.fn(),
    });

    render(<CreatePostPage />);

    expect(screen.queryByText("Verification required before posting")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mzansi Market/i })).toHaveAttribute(
      "href",
      "/post/create"
    );
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreatePostPage from "./page";

const { mockCreateClient, mockResolveAccountVerification } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockResolveAccountVerification: vi.fn(),
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/account/resolved-verification", () => ({
  resolveAccountVerification: mockResolveAccountVerification,
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
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });
    mockResolveAccountVerification.mockResolvedValue({
      accountVerificationStatus: "verified",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders exactly three category cards with the current category selection UI", async () => {
    render(await CreatePostPage());

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
    render(await CreatePostPage());

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
    mockResolveAccountVerification.mockResolvedValue({
      accountVerificationStatus: "incomplete",
    });

    render(await CreatePostPage());

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

  it("trusts the server-resolved verification status on first render", async () => {
    mockResolveAccountVerification.mockResolvedValue({
      accountVerificationStatus: "verified",
    });

    render(await CreatePostPage());

    await waitFor(() => {
      expect(screen.queryByText("Verification required before posting")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Mzansi Market/i })).toHaveAttribute(
        "href",
        "/post/create-listing"
      );
    });
  });

  it("does not render a checking-access placeholder while awaiting client hydration", async () => {
    render(await CreatePostPage());

    expect(screen.queryByText("Checking access")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mzansi Market/i })).toHaveAttribute(
      "href",
      "/post/create-listing"
    );
  });

  it("keeps unauthenticated users on verification-linked entry points without a member-only banner", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    render(await CreatePostPage());

    expect(screen.queryByText("Verification required before posting")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mzansi Market/i }).getAttribute("href")).toContain(
      "/verification?returnUrl=%2Fpost%2Fcreate-listing"
    );
  });
});

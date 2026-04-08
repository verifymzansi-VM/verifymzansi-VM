import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreatePostPage from "./page";

const { mockCreateClient, mockResolveAccountVerification, mockFetch, mockRedirect, mockPush } =
  vi.hoisted(() => {
    class RedirectError extends Error {
      digest = "NEXT_REDIRECT";
      constructor(public url: string) {
        super(`NEXT_REDIRECT;${url}`);
      }
    }
    return {
      mockCreateClient: vi.fn(),
      mockResolveAccountVerification: vi.fn(),
      mockFetch: vi.fn(),
      mockPush: vi.fn(),
      mockRedirect: vi.fn((url: string) => {
        throw new RedirectError(url);
      }),
    };
  });

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
  redirect: mockRedirect,
  useRouter: () => ({ push: mockPush }),
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
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ accountVerificationStatus: "incomplete" }),
    });
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the current category cards with the current category selection UI", async () => {
    render(await CreatePostPage());

    expect(screen.getAllByText("Mzansi Market").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mzansi Business").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tourism & Events").length).toBeGreaterThan(0);
    expect(screen.getByText("Pick a category to start posting.")).toBeInTheDocument();
    expect(screen.getByText("Sell, buy, or rent a single item.")).toBeInTheDocument();
    expect(screen.getByText("Create your full business profile.")).toBeInTheDocument();
    expect(screen.getByText("Create and promote events.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mzansi Market/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mzansi Business/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tourism & Events/i })).toBeInTheDocument();
  });

  it("sends verified users directly to the create forms", async () => {
    render(await CreatePostPage());

    fireEvent.click(screen.getByRole("button", { name: /Mzansi Market/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/post/create-listing");
    });
  });

  it("sends unverified users to verification with a returnUrl", async () => {
    mockResolveAccountVerification.mockResolvedValue({
      accountVerificationStatus: "incomplete",
    });

    render(await CreatePostPage());

    await waitFor(() => {
      expect(screen.getByText("Verification required before posting")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Mzansi Market/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/verification?returnUrl=%2Fpost%2Fcreate-listing");
    });
  });

  it("trusts the server-resolved verification status on first render", async () => {
    mockResolveAccountVerification.mockResolvedValue({
      accountVerificationStatus: "verified",
    });

    render(await CreatePostPage());

    await waitFor(() => {
      expect(screen.queryByText("Verification required before posting")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Mzansi Market/i })).toBeInTheDocument();
    });
  });

  it("does not render a checking-access placeholder while awaiting client hydration", async () => {
    render(await CreatePostPage());

    expect(screen.queryByText("Checking access")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mzansi Market/i })).toBeInTheDocument();
  });

  it("shows pending loading feedback and blocks repeated category clicks", async () => {
    render(await CreatePostPage());

    const marketButton = screen.getByRole("button", { name: /Mzansi Market/i });
    const businessButton = screen.getByRole("button", { name: /Mzansi Business/i });

    fireEvent.click(marketButton);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/post/create-listing");
    expect(marketButton).toBeDisabled();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(businessButton).toBeDisabled();

    fireEvent.click(businessButton);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("redirects unauthenticated users to login with returnUrl", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    await expect(CreatePostPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnUrl=%2Fpost%2Fcreate");
  });

  it("redirects unauthenticated users even when verification API would report verified", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    mockResolveAccountVerification.mockResolvedValue({
      accountVerificationStatus: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ accountVerificationStatus: "verified" }),
    });

    await expect(CreatePostPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnUrl=%2Fpost%2Fcreate");
  });
});

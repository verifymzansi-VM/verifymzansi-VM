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
    prefetch: _prefetch,
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

  it("renders each area with the choices its form supports", async () => {
    render(await CreatePostPage());

    expect(
      screen.getByRole("heading", { name: "What would you like to post?" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mzansi Market" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mzansi Business" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tourism" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    expect(screen.getAllByText("Tourism & Events")).toHaveLength(2);
    expect(screen.getByText("Advertising a job vacancy")).toBeInTheDocument();
    expect(screen.getByText("You run a shop, practice or service")).toBeInTheDocument();
    expect(screen.getByText("a venue for hire. Use Mzansi Business.")).toBeInTheDocument();
    expect(screen.getByText("Free to post")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create a market listing:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create a business profile:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create an event:/ })).toBeInTheDocument();
    expect(screen.getByText("Not sure?")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See advertising options/i })).toHaveAttribute(
      "href",
      "/advertise"
    );
  });

  it("opens each form with the chosen category or type preselected", async () => {
    render(await CreatePostPage());

    fireEvent.click(screen.getByRole("button", { name: /^Create a business profile:/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/post/create-business");
    });
  });

  it("routes common examples to the right area", async () => {
    render(await CreatePostPage());

    fireEvent.click(screen.getByRole("button", { name: /Holiday accommodation/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/post/create-tourism?type=tourism_business");
    });
  });

  it("sends verified users directly to the create forms", async () => {
    render(await CreatePostPage());

    fireEvent.click(screen.getByRole("button", { name: /^Create a market listing:/ }));

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

    fireEvent.click(screen.getByRole("button", { name: /^Create a market listing:/ }));

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
      expect(screen.getByRole("button", { name: /^Create a market listing:/ })).toBeInTheDocument();
    });
  });

  it("does not render a checking-access placeholder while awaiting client hydration", async () => {
    render(await CreatePostPage());

    expect(screen.queryByText("Checking access")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create a market listing:/ })).toBeInTheDocument();
  });

  it("updates the posting gate copy when the verification status refresh resolves to pending review", async () => {
    mockResolveAccountVerification.mockResolvedValue({
      accountVerificationStatus: "incomplete",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ accountVerificationStatus: "pending_review" }),
    });

    render(await CreatePostPage());

    await waitFor(() => {
      expect(screen.getByText("Verification required before posting")).toBeInTheDocument();
      expect(
        screen.getByText("Your verification is being reviewed. You can post once it's approved.")
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Create a market listing:/ }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/verification?returnUrl=%2Fpost%2Fcreate-listing");
    });
  });

  it("shows pending loading feedback and blocks repeated category clicks", async () => {
    render(await CreatePostPage());

    const marketButton = screen.getByRole("button", { name: /^Create a market listing:/ });
    const businessButton = screen.getByRole("button", { name: /^Create an event:/ });

    fireEvent.click(marketButton);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/post/create-listing");
    expect(marketButton).toBeDisabled();
    expect(screen.getByText("Opening form...")).toBeInTheDocument();
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

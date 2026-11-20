import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreatePostPage from "./page";

const {
  mockReadSession,
  mockRpc,
  mockLegacyClient,
  SessionError,
  mockFetch,
  mockRedirect,
  mockPush,
} = vi.hoisted(() => {
  class RedirectError extends Error {
    digest = "NEXT_REDIRECT";
    constructor(public url: string) {
      super(`NEXT_REDIRECT;${url}`);
    }
  }
  class SessionError extends Error {
    constructor(readonly status: 401 | 403 | 503) {
      super("A verified account page session is required");
    }
  }
  return {
    mockReadSession: vi.fn(),
    mockRpc: vi.fn(),
    mockLegacyClient: vi.fn(() => {
      throw new Error("old backend client used");
    }),
    SessionError,
    mockFetch: vi.fn(),
    mockPush: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      throw new RedirectError(url);
    }),
  };
});

/** What get_my_verification_case answers (the live verification read). */
const verificationCase = (change: Record<string, unknown> = {}) => ({
  case_id: "00000000-0000-4000-8000-0000000000c1",
  version: 2,
  verified: false,
  phone_verified: true,
  locality_confirmed: true,
  submission_pending: false,
  return_reason: null,
  ...change,
});
const VERIFIED = { verified: true };

/** Answers the page's verification read; a returned case also gets its decision. */
function answerVerification(change: Record<string, unknown>, decision: string | null = null) {
  mockRpc.mockImplementation(async (name: string) =>
    name === "get_my_verification_case"
      ? { data: verificationCase(change), error: null }
      : {
          data: {
            account_id: "user-1",
            case_id: "00000000-0000-4000-8000-0000000000c1",
            case_version: 2,
            reason: change.return_reason ?? null,
            decision,
          },
          error: null,
        }
  );
}

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

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockLegacyClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockLegacyClient }));
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: mockReadSession,
  FoundationServerSessionError: SessionError,
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
    mockReadSession.mockResolvedValue({ user: { id: "user-1" }, api: { rpc: mockRpc } });
    answerVerification(VERIFIED);
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
    answerVerification({ phone_verified: false });

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
    answerVerification(VERIFIED);

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
    answerVerification({ phone_verified: false });
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
    mockReadSession.mockRejectedValue(new SessionError(401));

    await expect(CreatePostPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnUrl=%2Fpost%2Fcreate");
  });

  it("redirects unauthenticated users even when verification API would report verified", async () => {
    mockReadSession.mockRejectedValue(new SessionError(401));
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ accountVerificationStatus: "verified" }),
    });

    await expect(CreatePostPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnUrl=%2Fpost%2Fcreate");
  });
  // Every status the live verification read can give, as the page first shows it.
  it.each([
    ["verified", VERIFIED, null, null],
    [
      "pending_review",
      { submission_pending: true },
      null,
      "Your verification is being reviewed. You can post once it's approved.",
    ],
    [
      "rejected",
      { return_reason: "document_unreadable" },
      "rejected",
      "Your verification wasn't approved. Check the feedback and try again.",
    ],
    [
      "incomplete (sent back to fix)",
      { return_reason: "document_unreadable" },
      "needs_resubmission",
      "Finish verification to start posting.",
    ],
    ["incomplete", { phone_verified: false }, null, "Finish verification to start posting."],
  ] as const)("shows a %s member the matching note", async (_status, change, decision, note) => {
    answerVerification(change, decision);
    // The browser's own refresh stays out of the way: only the first render counts.
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(await CreatePostPage());

    if (note === null) {
      expect(screen.queryByText("Verification required before posting")).not.toBeInTheDocument();
    } else {
      expect(screen.getByText("Verification required before posting")).toBeInTheDocument();
      expect(screen.getByText(note)).toBeInTheDocument();
    }
    expect(mockRpc).toHaveBeenCalledWith("get_my_verification_case", {}, { get: false });
    expect(mockLegacyClient).not.toHaveBeenCalled();
  });

  it("shows the finish-verification note when the verification read fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PGRST000" } });
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(await CreatePostPage());

    expect(screen.getByText("Verification required before posting")).toBeInTheDocument();
    expect(screen.getByText("Finish verification to start posting.")).toBeInTheDocument();
  });

  it.each([403, 503] as const)(
    "does not treat a %s session refusal as signed out",
    async (status) => {
      mockReadSession.mockRejectedValue(new SessionError(status));

      await expect(CreatePostPage()).rejects.toMatchObject({ status });
      expect(mockRedirect).not.toHaveBeenCalled();
    }
  );
});

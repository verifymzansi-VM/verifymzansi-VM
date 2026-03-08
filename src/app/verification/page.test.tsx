import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VerificationPage from "./page";
import { useSearchParams } from "next/navigation";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock("@/components/trust/verification-progress", () => ({
  VerificationProgress: () => <div data-testid="verification-progress" />,
}));

describe("VerificationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: "session-1",
        completedSteps: ["phone", "id_doc", "selfie", "location"],
        pendingSteps: [],
        requiredSteps: ["phone", "id_doc", "selfie", "location"],
        finalizedAt: "2026-03-08T12:00:00.000Z",
        phoneVerifiedAt: "2026-03-08T11:00:00.000Z",
      }),
    }) as unknown as typeof fetch;
  });

  it("uses the supplied returnUrl on the completion card", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("returnUrl=%2Fpost%2Fcreate-business")
    );

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Return to Posting/i })).toHaveAttribute(
        "href",
        "/post/create-business"
      );
    });
  });

  it("falls back to /dashboard when no returnUrl is provided", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams());

    render(<VerificationPage />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Go to Dashboard/i })).toHaveAttribute(
        "href",
        "/dashboard"
      );
    });
  });
});

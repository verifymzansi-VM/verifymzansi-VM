import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as TurnstileClient from "@/lib/turnstile-client";

const { mockToast, mockEnsureCsrfTokenReady, mockTurnstileRetry } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockEnsureCsrfTokenReady: vi.fn(),
  mockTurnstileRetry: vi.fn(),
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

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: mockEnsureCsrfTokenReady,
  withCsrfHeaders: (headers?: HeadersInit) => {
    const nextHeaders = new Headers(headers);
    nextHeaders.set("x-csrf-token", "a".repeat(64));
    return nextHeaders;
  },
}));

vi.mock("@/lib/turnstile-client", async (importOriginal) => ({
  ...(await importOriginal<typeof TurnstileClient>()),
  getTurnstileClientState: () => ({ mode: "configured", siteKey: "test-site-key" }),
}));

vi.mock("@/components/ui/turnstile-widget", async () => {
  const { useEffect } = await import("react");
  return {
    TurnstileWidget: Object.assign(
      ({
        onSuccess,
        retryToken = 0,
      }: {
        onSuccess?: (token: string) => void;
        retryToken?: number;
      }) => {
        useEffect(() => {
          onSuccess?.(`token-${retryToken}`);
        }, [onSuccess, retryToken]);
        return <div data-testid="turnstile-widget" data-retry-token={String(retryToken)} />;
      },
      { retry: mockTurnstileRetry }
    ),
  };
});

import ForgotPasswordPage from "./page";

async function submitEmail(email: string) {
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureCsrfTokenReady.mockResolvedValue("a".repeat(64));
  });

  it("bootstraps CSRF before posting and confirms without revealing whether the account exists", async () => {
    const callOrder: string[] = [];
    mockEnsureCsrfTokenReady.mockImplementation(async () => {
      callOrder.push("csrf");
      return "a".repeat(64);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callOrder.push("fetch");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      })
    );

    render(<ForgotPasswordPage />);
    await submitEmail("nomsa@example.com");

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText(/has an account/i)).toHaveTextContent(
      "If nomsa@example.com has an account, a reset link is on its way."
    );
    expect(callOrder.at(-1)).toBe("fetch");
    expect(callOrder).toContain("csrf");
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute(
      "href",
      "/login"
    );

    vi.unstubAllGlobals();
  });

  it("does not post when the CSRF token cannot be prepared", async () => {
    mockEnsureCsrfTokenReady.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<ForgotPasswordPage />);
    await submitEmail("nomsa@example.com");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Security check failed", variant: "destructive" })
      )
    );
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("asks for a fresh security check after a failed request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 })
      )
    );

    render(<ForgotPasswordPage />);
    await submitEmail("nomsa@example.com");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Reset request failed", description: "Too many requests" })
      )
    );
    expect(mockTurnstileRetry).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("turnstile-widget")).toHaveAttribute("data-retry-token", "1")
    );

    vi.unstubAllGlobals();
  });
});

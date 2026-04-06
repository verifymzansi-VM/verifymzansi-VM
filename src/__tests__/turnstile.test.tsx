/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, render, waitFor } from "@testing-library/react";

const { mockShouldBypassTurnstileInNonProduction, mockTurnstileRender, mockTurnstileRemove } =
  vi.hoisted(() => ({
    mockShouldBypassTurnstileInNonProduction: vi.fn(() => false),
    mockTurnstileRender: vi.fn(() => "widget-id"),
    mockTurnstileRemove: vi.fn(),
  }));

vi.mock("@/lib/turnstile-mode", () => ({
  shouldBypassTurnstileInNonProduction: mockShouldBypassTurnstileInNonProduction,
}));

vi.mock("@/hooks/use-hydrated", () => ({
  useHydrated: () => true,
}));

vi.mock("@/lib/public-runtime-config", () => ({
  getPublicRuntimeConfig: () => ({
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://verifymzansi.com",
    supabaseUrl: "",
    supabaseAnonKey: "",
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
    cfImageResizing: false,
    officialSocialLinks: {},
  }),
}));

// Mock the Turnstile script loading
vi.stubGlobal("turnstile", {
  render: mockTurnstileRender,
  reset: vi.fn(),
  remove: mockTurnstileRemove,
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const { TurnstileWidget } = await import("@/components/ui/turnstile-widget");

describe("TurnstileWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShouldBypassTurnstileInNonProduction.mockReturnValue(false);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      const appended = HTMLElement.prototype.appendChild.call(document.head, node);
      setTimeout(() => {
        (window as typeof window & { __turnstile_onload?: () => void }).__turnstile_onload?.();
      }, 0);
      return appended;
    });
  });

  it("should render without crashing", () => {
    const { container } = render(<TurnstileWidget onSuccess={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it("should not auto-bypass in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const onSuccess = vi.fn();

    render(<TurnstileWidget onSuccess={onSuccess} />);

    // Should NOT auto-call onSuccess (bypass removed)
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("bypasses the widget on non-production hosts that should not use live Turnstile", async () => {
    mockShouldBypassTurnstileInNonProduction.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    const onSuccess = vi.fn();

    render(<TurnstileWidget onSuccess={onSuccess} />);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("dev-turnstile-bypass");
    });
    expect(mockTurnstileRender).not.toHaveBeenCalled();
  });

  it("escalates terminal Cloudflare widget errors into an unavailable state", async () => {
    const onUnavailable = vi.fn();
    const onError = vi.fn();

    render(<TurnstileWidget onSuccess={vi.fn()} onUnavailable={onUnavailable} onError={onError} />);

    await waitFor(() => {
      expect(mockTurnstileRender).toHaveBeenCalled();
    });

    const [, options] = mockTurnstileRender.mock.calls[0] as unknown as [
      HTMLElement,
      { "error-callback": (error: string) => void },
    ];

    await act(async () => {
      options["error-callback"]("Cloudflare Turnstile Error: 110200");
    });

    await waitFor(() => {
      expect(onUnavailable).toHaveBeenCalled();
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not recreate the widget when parent callbacks change", async () => {
    const firstUnavailable = vi.fn();
    const secondUnavailable = vi.fn();
    const { rerender } = render(
      <TurnstileWidget onSuccess={vi.fn()} onUnavailable={firstUnavailable} />
    );

    await waitFor(() => {
      expect(mockTurnstileRender).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rerender(<TurnstileWidget onSuccess={vi.fn()} onUnavailable={secondUnavailable} />);
    });

    await waitFor(() => {
      expect(mockTurnstileRender).toHaveBeenCalledTimes(1);
    });
    expect(mockTurnstileRemove).not.toHaveBeenCalled();
  });

  it("recreates the widget only when retryToken changes", async () => {
    const { rerender } = render(<TurnstileWidget onSuccess={vi.fn()} retryToken={0} />);

    await waitFor(() => {
      expect(mockTurnstileRender).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rerender(<TurnstileWidget onSuccess={vi.fn()} retryToken={1} />);
    });

    await waitFor(() => {
      expect(mockTurnstileRender).toHaveBeenCalledTimes(2);
    });
    expect(mockTurnstileRemove).toHaveBeenCalledTimes(1);
  });
});

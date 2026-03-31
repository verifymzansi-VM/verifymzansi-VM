/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToast, mockEnsureCsrfTokenReady } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockEnsureCsrfTokenReady: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: mockEnsureCsrfTokenReady,
  withCsrfHeaders: (headers?: HeadersInit) => {
    const nextHeaders = new Headers(headers);
    nextHeaders.set("x-csrf-token", "a".repeat(64));
    return nextHeaders;
  },
}));

import { GoogleOAuthButton } from "./google-oauth-button";

describe("GoogleOAuthButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureCsrfTokenReady.mockResolvedValue("a".repeat(64));
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState({}, "", "/login?returnUrl=/verification");
  });

  it("bootstraps CSRF before starting the Google OAuth request", async () => {
    const callOrder: string[] = [];
    mockEnsureCsrfTokenReady.mockImplementation(async () => {
      callOrder.push("csrf");
      return "a".repeat(64);
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("fetch");
      return {
        ok: true,
        json: async () => ({ url: "#oauth-ok" }),
      };
    });

    render(<GoogleOAuthButton mode="login" />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(callOrder.length).toBeGreaterThanOrEqual(2);
    expect(callOrder.at(-1)).toBe("fetch");
    expect(callOrder.slice(0, -1)).toEqual(expect.arrayContaining(["csrf"]));
    expect(mockEnsureCsrfTokenReady).toHaveBeenCalled();
    expect(
      ((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers as Headers).get(
        "x-csrf-token"
      )
    ).toBe("a".repeat(64));
  });

  it("shows a toast instead of posting when CSRF bootstrap fails", async () => {
    mockEnsureCsrfTokenReady.mockResolvedValue(null);

    render(<GoogleOAuthButton mode="login" />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Security check failed",
          variant: "destructive",
        })
      );
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

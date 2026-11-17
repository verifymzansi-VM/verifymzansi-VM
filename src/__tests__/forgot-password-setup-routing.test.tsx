import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as TurnstileClient from "@/lib/turnstile-client";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { isFoundationPasswordSetupInput } from "@/lib/foundation/password-setup-input";

// The forgot-password page and the profile page's "Set Password" post to the
// same URL. The server treats a body of only `email` as password setup (a
// signed-in request without a CAPTCHA token). These tests pin that the
// restored forgot-password page (a frozen file, read here, not changed) always
// sends a non-empty token field, so it can never be routed to password setup.

const { mockWidget } = vi.hoisted(() => ({ mockWidget: { outcome: "success" as string } }));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn(async () => "a".repeat(64)),
  withCsrfHeaders: (headers?: HeadersInit) => {
    const next = new Headers(headers);
    next.set("x-csrf-token", "a".repeat(64));
    return next;
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
      ({ onSuccess, onError }: { onSuccess?: (token: string) => void; onError?: () => void }) => {
        useEffect(() => {
          if (mockWidget.outcome === "success") onSuccess?.("synthetic-widget-token");
          else onError?.();
        }, [onSuccess, onError]);
        return <div data-testid="turnstile-widget" />;
      },
      { retry: vi.fn() }
    ),
  };
});

import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";

async function submittedBody() {
  const fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ForgotPasswordPage />);
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nomsa@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/auth/forgot-password");
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("forgot-password requests never look like password setup", () => {
  beforeEach(() => {
    mockWidget.outcome = "success";
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["success", "error"])(
    "the page sends the email and a non-empty token field (widget %s)",
    async (outcome) => {
      mockWidget.outcome = outcome;
      const body = await submittedBody();
      expect(Object.keys(body).sort()).toEqual(["email", "turnstileToken"]);
      expect(typeof body.turnstileToken).toBe("string");
      expect(String(body.turnstileToken).length).toBeGreaterThan(0);
      expect(isFoundationPasswordSetupInput(body)).toBe(false);
    }
  );

  it("the page's form cannot be submitted without a token", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nomsa@example.com" }).success).toBe(false);
    expect(
      forgotPasswordSchema.safeParse({ email: "nomsa@example.com", turnstileToken: "" }).success
    ).toBe(false);
  });
});

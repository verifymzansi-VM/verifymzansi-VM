import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginPage from "./page";
import { clearClientAccountState } from "@/hooks/use-auth";

vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/use-auth", () => ({ clearClientAccountState: vi.fn(async () => {}) }));
vi.mock("@/hooks/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ui/google-oauth-button", () => ({
  GoogleOAuthButton: () => <p>Google sign in</p>,
}));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: async () => "synthetic",
  withCsrfHeaders: (input: HeadersInit) => new Headers(input),
}));
vi.mock("@/lib/turnstile-client", () => ({
  getTurnstileClientState: () => ({ mode: "configured" }),
  TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE: "Domain unavailable",
  TURNSTILE_UNAVAILABLE_MESSAGE: "Security check unavailable",
}));
vi.mock("@/components/ui/turnstile-widget", () => {
  const Widget = ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <div>
      <button type="button" onClick={() => onSuccess("synthetic-login-captcha")}>
        Complete CAPTCHA
      </button>
      <button type="button" onClick={() => onSuccess("turnstile-unavailable")}>
        Unavailable CAPTCHA
      </button>
      <button type="button" onClick={() => onSuccess("dev-turnstile-bypass")}>
        Development CAPTCHA
      </button>
    </div>
  );
  Widget.retry = vi.fn();
  return { TurnstileWidget: Widget };
});
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/login");
  fetcher.mockResolvedValue(Response.json({ error: "Unable to sign in" }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
async function fill(tokenButton: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: tokenButton }));
  const submit = screen.getByRole("button", { name: /^sign in$/i });
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
}
it("sends native sign-in to the new route and clears stale account data before the request", async () => {
  render(<LoginPage />);
  await fill("Complete CAPTCHA");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(clearClientAccountState).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/foundation/auth/login");
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  expect(screen.queryByText("Google sign in")).not.toBeInTheDocument();
});
it.each(["Unavailable CAPTCHA", "Development CAPTCHA"])(
  "blocks native Auth for %s",
  async (label) => {
    render(<LoginPage />);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeDisabled();
    expect(fetcher).not.toHaveBeenCalled();
  }
);

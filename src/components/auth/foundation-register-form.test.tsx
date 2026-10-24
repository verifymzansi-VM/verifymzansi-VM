import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RegisterPage from "@/app/(auth)/register/page";
import { ensureCsrfTokenReady } from "@/lib/utils/csrf";

const { retry } = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/hooks/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn(),
  withCsrfHeaders: (headers: HeadersInit) => new Headers(headers),
}));
vi.mock("@/components/ui/turnstile-widget", () => {
  const Widget = ({
    onSuccess,
    onExpire,
  }: {
    onSuccess: (token: string) => void;
    onExpire: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSuccess("synthetic-registration-token")}>
        Complete security check
      </button>
      <button type="button" onClick={onExpire}>
        Expire security check
      </button>
      <button type="button" onClick={() => onSuccess("dev-turnstile-bypass")}>
        Development security check
      </button>
    </div>
  );
  Widget.retry = retry;
  return { TurnstileWidget: Widget };
});
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureCsrfTokenReady).mockResolvedValue("synthetic-csrf");
  fetcher.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
function fill() {
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Thando M." } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "NEW@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "synthetic-long-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "synthetic-long-password" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Complete security check" }));
}
it("selects the fresh-account form and sends only its canonical fields to the foundation route", async () => {
  render(<RegisterPage />);
  fill();
  expect(screen.queryByLabelText(/mobile number/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByRole("heading", { name: "Check your inbox" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("/api/foundation/auth/register");
  expect(init).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  expect(JSON.parse(String(init?.body))).toEqual({
    displayName: "Thando M.",
    email: "new@example.invalid",
    password: "synthetic-long-password",
    confirmPassword: "synthetic-long-password",
    acceptTerms: true,
    turnstileToken: "synthetic-registration-token",
  });
});
it("requires a fresh security token after a refused registration request", async () => {
  fetcher.mockResolvedValue(Response.json({ error: "Try again shortly" }, { status: 503 }));
  render(<RegisterPage />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  expect(retry).toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not contact Auth without the same-origin security check", async () => {
  vi.mocked(ensureCsrfTokenReady).mockResolvedValue(null);
  render(<RegisterPage />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByRole("alert");
  expect(fetcher).not.toHaveBeenCalled();
});
it("removes an expired CAPTCHA and blocks submission", () => {
  render(<RegisterPage />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Expire security check" }));
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
});
it("never treats the source development bypass as a native CAPTCHA", () => {
  render(<RegisterPage />);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Development security check" }));
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  expect(fetcher).not.toHaveBeenCalled();
});

import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FoundationPasswordForm } from "./foundation-password-form";
import { useAuthStore } from "@/stores/auth-store";
import { ensureCsrfTokenReady } from "@/lib/utils/csrf";
vi.mock("@/hooks/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn(),
  withCsrfHeaders: (headers: HeadersInit) => new Headers(headers),
}));
const id = "00000000-0000-4000-8000-000000000001";
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore
    .getState()
    .setUser({ id, email: "member@example.invalid", displayName: "Member", role: "member" });
  vi.mocked(ensureCsrfTokenReady).mockResolvedValue("synthetic");
  fetcher.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().reset();
});
function fill() {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "synthetic-current" },
  });
  fireEvent.change(screen.getByLabelText("New password", { exact: true }), {
    target: { value: "synthetic-new-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "synthetic-new-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
}
it("submits the native bounded payload without account selectors and clears credentials on success", async () => {
  render(<FoundationPasswordForm accountId={id} />);
  fill();
  await screen.findByText("Password updated.");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/foundation/auth/password");
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "manual",
  });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    currentPassword: "synthetic-current",
    newPassword: "synthetic-new-password",
    confirmNewPassword: "synthetic-new-password",
  });
  expect(screen.getByLabelText("Current password")).toHaveValue("");
  expect(screen.getByLabelText("New password", { exact: true })).toHaveValue("");
});
it("does not send credentials if request protection cannot be prepared", async () => {
  vi.mocked(ensureCsrfTokenReady).mockResolvedValue(null);
  render(<FoundationPasswordForm accountId={id} />);
  fill();
  await screen.findByRole("alert");
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps an MFA refusal visible rather than claiming a password change", async () => {
  fetcher.mockResolvedValue(
    Response.json(
      { error: "Confirm your authenticator code", reason: "mfa_required" },
      { status: 403 }
    )
  );
  render(<FoundationPasswordForm accountId={id} />);
  fill();
  expect(await screen.findByRole("alert")).toHaveTextContent("Confirm your authenticator code");
  expect(screen.queryByText("Password updated.")).not.toBeInTheDocument();
});
it("does not treat an unexpected success payload as confirmation", async () => {
  fetcher.mockResolvedValue(Response.json({ unexpected: true }));
  render(<FoundationPasswordForm accountId={id} />);
  fill();
  await screen.findByRole("alert");
  expect(screen.queryByText("Password updated.")).not.toBeInTheDocument();
});
it("hides the old form and ignores its late response after account replacement", async () => {
  let finish!: (response: Response) => void;
  fetcher.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  render(<FoundationPasswordForm accountId={id} />);
  fill();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  act(() =>
    useAuthStore.getState().setUser({
      id: "00000000-0000-4000-8000-000000000002",
      email: "other@example.invalid",
      displayName: "Other",
      role: "member",
    })
  );
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  await act(async () => finish(Response.json({ ok: true })));
  expect(screen.queryByText("Password updated.")).not.toBeInTheDocument();
});

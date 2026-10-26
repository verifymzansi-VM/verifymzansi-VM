import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import CompleteProfilePage from "@/app/dashboard/complete-profile/page";
import { useAuthStore } from "@/stores/auth-store";
import type { FoundationAccountContext } from "@/lib/foundation/account-context";
import { ensureCsrfTokenReady } from "@/lib/utils/csrf";

const { replace, refresh, legacy } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: legacy }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: useAuthStore.getState().user,
    foundationContext: useAuthStore.getState().foundationContext,
    isLoading: false,
    refresh,
  }),
}));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn(),
  withCsrfHeaders: (input: HeadersInit) => new Headers(input),
}));
const owner = "00000000-0000-4000-8000-000000000001";
const challenge = "00000000-0000-4000-8000-000000000002";
const context: FoundationAccountContext = {
  version: 1,
  account_id: owner,
  email: "member@example.invalid",
  phone: null,
  staff: null,
  totp_enrolled: false,
  profile: {
    display_name: "Thando",
    public_name: "Thando",
    bio: null,
    avatar_object_id: null,
    legal_first_name: null,
    legal_last_name: null,
    legal_name_locked: false,
    identity_verified: false,
    revision: 1,
    updated_at: "2026-10-24T00:00:00Z",
  },
};
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().applyFoundationContext(context);
  vi.mocked(ensureCsrfTokenReady).mockResolvedValue("synthetic");
  refresh.mockImplementation(async () =>
    useAuthStore.getState().applyFoundationContext({ ...context, phone: "+27820000000" })
  );
  fetcher.mockResolvedValue(
    Response.json({ challenge_id: challenge, expires_at: "2026-10-24T18:00:00Z" })
  );
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState({}, "", "/dashboard/complete-profile");
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().reset();
});
function send() {
  fireEvent.change(screen.getByLabelText("South African mobile number"), {
    target: { value: "0820000000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
}
it("completes the new phone journey without any legacy table access or submitted account selector", async () => {
  render(<CompleteProfilePage />);
  send();
  const input = await screen.findByLabelText("Verification code");
  expect(fetcher.mock.calls[0][0]).toBe("/api/foundation/phone/send");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ phone: "+27820000000" });
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "manual",
  });
  fetcher.mockResolvedValueOnce(Response.json({ verified: true }));
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify number" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  expect(fetcher.mock.calls[1][0]).toBe("/api/foundation/phone/verify");
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    challenge_id: challenge,
    code: "123456",
  });
  expect(legacy).not.toHaveBeenCalled();
});
it("does not contact the phone endpoint if the same-origin request proof cannot be prepared", async () => {
  vi.mocked(ensureCsrfTokenReady).mockResolvedValue(null);
  render(<CompleteProfilePage />);
  send();
  await screen.findByRole("alert");
  expect(fetcher).not.toHaveBeenCalled();
});
it("refuses malformed or authority-bearing challenge replies", async () => {
  fetcher.mockResolvedValue(
    Response.json({
      challenge_id: challenge,
      expires_at: "2026-10-24T18:00:00Z",
      otp_hash: "forbidden",
    })
  );
  render(<CompleteProfilePage />);
  send();
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
});
it("keeps a failed code attempt available for correction without refreshing a verified status", async () => {
  render(<CompleteProfilePage />);
  send();
  const input = await screen.findByLabelText("Verification code");
  fetcher.mockResolvedValueOnce(Response.json({ error: "Invalid code" }, { status: 400 }));
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify number" }));
  await screen.findByRole("alert");
  expect(refresh).not.toHaveBeenCalled();
  expect(input).toHaveValue("123456");
});
it("does not display or restore the previous account's pending challenge after an account switch", async () => {
  let finish!: (response: Response) => void;
  fetcher.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const view = render(<CompleteProfilePage />);
  send();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  useAuthStore.getState().applyFoundationContext({ ...context, account_id: challenge });
  view.rerender(<CompleteProfilePage />);
  expect(screen.getByLabelText("South African mobile number")).toHaveValue("");
  await act(async () =>
    finish(Response.json({ challenge_id: challenge, expires_at: "2026-10-24T18:00:00Z" }))
  );
  expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
});
it("uses the verified account context and never follows an external continuation URL", async () => {
  window.history.replaceState(
    {},
    "",
    "/dashboard/complete-profile?returnUrl=https://external.example"
  );
  useAuthStore.getState().applyFoundationContext({ ...context, phone: "+27820000000" });
  render(<CompleteProfilePage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  expect(fetcher).not.toHaveBeenCalled();
  expect(legacy).not.toHaveBeenCalled();
});

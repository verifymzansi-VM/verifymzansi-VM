import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FoundationAccountContext } from "@/lib/foundation/account-context";
import { useAuth, clearClientAccountState } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";

const { fetchSession, legacyClient, subscribe } = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  legacyClient: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/lib/foundation/browser-session-cookie", () => ({
  hasFoundationBrowserSession: () => true,
}));
vi.mock("@/lib/foundation/account-session-client", () => ({
  fetchFoundationAccountSession: fetchSession,
}));
vi.mock("@/lib/foundation/browser-client", () => ({
  getFoundationBrowserClient: () => ({ auth: { onAuthStateChange: subscribe } }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: legacyClient }));
function account(id: string): FoundationAccountContext {
  return {
    version: 1,
    account_id: id,
    email: "member@example.invalid",
    phone: null,
    totp_enrolled: true,
    staff: { role: "governor", can_access: false, assigned_capabilities: ["queue:view"] },
    profile: {
      display_name: "Thando M.",
      public_name: "Thando M.",
      bio: null,
      avatar_object_id: null,
      legal_first_name: null,
      legal_last_name: null,
      legal_name_locked: false,
      identity_verified: true,
      revision: 1,
      updated_at: "2026-10-24T00:00:00Z",
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().reset();
  subscribe.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});
it("loads canonical account data without reading the legacy profile table or mutable role metadata", async () => {
  const data = account("00000000-0000-4000-8000-000000000001");
  fetchSession.mockResolvedValue(data);
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.user?.role).toBe("governor");
  expect(result.current.isModerator).toBe(true);
  expect(result.current.isVerified).toBe(true);
  expect(result.current.foundationContext).toEqual(data);
  expect(result.current.profile).toBeNull();
  expect(legacyClient).not.toHaveBeenCalled();
});
it("cannot restore an earlier account response after sign-out invalidates it", async () => {
  let finish!: (value: FoundationAccountContext) => void;
  fetchSession.mockReturnValue(
    new Promise<FoundationAccountContext>((resolve) => {
      finish = resolve;
    })
  );
  renderHook(() => useAuth());
  await waitFor(() => expect(fetchSession).toHaveBeenCalled());
  await act(async () => {
    await clearClientAccountState();
    finish(account("00000000-0000-4000-8000-000000000001"));
  });
  expect(useAuthStore.getState().user).toBeNull();
  expect(useAuthStore.getState().foundationContext).toBeNull();
});
it("keeps the newer account when an older refresh completes last", async () => {
  let finish!: (value: FoundationAccountContext) => void;
  fetchSession
    .mockReturnValueOnce(
      new Promise<FoundationAccountContext>((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValueOnce(account("00000000-0000-4000-8000-000000000002"));
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(1));
  await act(async () => {
    await result.current.refresh();
  });
  await act(async () => {
    finish(account("00000000-0000-4000-8000-000000000001"));
  });
  expect(useAuthStore.getState().user?.id).toBe("00000000-0000-4000-8000-000000000002");
});

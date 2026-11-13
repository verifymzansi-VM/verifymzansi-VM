import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const { getUser, onAuthStateChange, fetchFoundationAccountSession } = vi.hoisted(() => ({
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  fetchFoundationAccountSession: vi.fn(),
}));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({ auth: { getUser, onAuthStateChange } }),
}));
vi.mock("@/lib/foundation/account-session-client", () => ({ fetchFoundationAccountSession }));
vi.mock("@/lib/foundation/verification-runtime-client", () => ({
  readFoundationVerificationStatus: vi.fn(async () => ({})),
}));
vi.mock("@/lib/foundation/restored-profile", () => ({
  restoredAccountProfile: (account: { account_id: string }) => ({
    user_id: account.account_id,
    display_name: account.account_id,
  }),
}));

import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";

type Account = { account_id: string; email: string; staff: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const user = (id: string) => ({
  id,
  email: `${id}@example.com`,
  user_metadata: {},
  app_metadata: {},
});
const account = (id: string): Account => ({
  account_id: id,
  email: `${id}@example.com`,
  staff: null,
});

describe("auth session request races", () => {
  let authChanged: (event: AuthChangeEvent, session: Session | null) => void;
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().reset();
    document.cookie = "sb-projectref-auth-token=session; path=/";
    onAuthStateChange.mockImplementation((callback) => {
      authChanged = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
  });

  it("cannot restore a user when an earlier lookup completes after sign-out", async () => {
    const lookup = deferred<{ data: { user: ReturnType<typeof user> } }>();
    getUser.mockReturnValue(lookup.promise);
    renderHook(() => useAuth());
    await waitFor(() => expect(getUser).toHaveBeenCalled());
    await act(async () => {
      authChanged("SIGNED_OUT", null);
      lookup.resolve({ data: { user: user("old") } });
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(fetchFoundationAccountSession).not.toHaveBeenCalled();
  });

  it("discards a pending account after the session ends", async () => {
    const pending = deferred<Account>();
    getUser.mockResolvedValue({ data: { user: user("old") } });
    fetchFoundationAccountSession.mockReturnValue(pending.promise);
    renderHook(() => useAuth());
    await waitFor(() => expect(fetchFoundationAccountSession).toHaveBeenCalled());
    await act(async () => {
      authChanged("SIGNED_OUT", null);
      pending.resolve(account("old"));
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
  });

  it("keeps the new account profile when an older account request finishes last", async () => {
    const oldAccount = deferred<Account>();
    getUser
      .mockResolvedValueOnce({ data: { user: user("old") } })
      .mockResolvedValueOnce({ data: { user: user("new") } });
    fetchFoundationAccountSession
      .mockReturnValueOnce(oldAccount.promise)
      .mockResolvedValueOnce(account("new"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(fetchFoundationAccountSession).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      oldAccount.resolve(account("old"));
    });
    expect(useAuthStore.getState().user?.id).toBe("new");
    expect(useAuthStore.getState().profile).toEqual({ user_id: "new", display_name: "new" });
  });

  it("signs out when the account session belongs to someone else", async () => {
    getUser.mockResolvedValue({ data: { user: user("old") } });
    fetchFoundationAccountSession.mockResolvedValue(account("other"));
    renderHook(() => useAuth());
    await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
    expect(useAuthStore.getState().user).toBeNull();
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const { getUser, maybeSingle, onAuthStateChange } = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser, onAuthStateChange },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";

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
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("discards a pending profile after the session ends", async () => {
    const profile = deferred<{ data: { user_id: string }; error: null }>();
    getUser.mockResolvedValue({ data: { user: user("old") } });
    maybeSingle.mockReturnValue(profile.promise);
    renderHook(() => useAuth());
    await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
    await act(async () => {
      authChanged("SIGNED_OUT", null);
      profile.resolve({ data: { user_id: "old" }, error: null });
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
  });

  it("keeps the new account profile when an older account request finishes last", async () => {
    const oldProfile = deferred<{ data: { user_id: string }; error: null }>();
    getUser
      .mockResolvedValueOnce({ data: { user: user("old") } })
      .mockResolvedValueOnce({ data: { user: user("new") } });
    maybeSingle
      .mockReturnValueOnce(oldProfile.promise)
      .mockResolvedValueOnce({ data: { user_id: "new" }, error: null });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    await act(async () => {
      oldProfile.resolve({ data: { user_id: "old" }, error: null });
    });
    expect(useAuthStore.getState().user?.id).toBe("new");
    expect(useAuthStore.getState().profile).toEqual({ user_id: "new" });
  });
});

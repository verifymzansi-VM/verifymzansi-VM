import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "./auth-store";

describe("auth-store", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      profile: null,
      trustLevel: 0,
      isLoading: true,
    });
  });

  it("setUser stores the user", () => {
    useAuthStore.getState().setUser({ id: "u1", email: "a@b.com", displayName: "A", role: "user" });
    expect(useAuthStore.getState().user?.id).toBe("u1");
  });

  it("setProfile stores the profile", () => {
    useAuthStore.getState().setProfile({ id: "p1" } as never);
    expect(useAuthStore.getState().profile).toEqual({ id: "p1" });
  });

  it("setTrustLevel updates trust", () => {
    useAuthStore.getState().setTrustLevel(2);
    expect(useAuthStore.getState().trustLevel).toBe(2);
  });

  it("setLoading updates loading flag", () => {
    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it("reset clears state", () => {
    useAuthStore.getState().setUser({ id: "u1", email: "a@b.com", displayName: "A", role: "user" });
    useAuthStore.getState().reset();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.trustLevel).toBe(0);
    expect(state.isLoading).toBe(false);
  });
});

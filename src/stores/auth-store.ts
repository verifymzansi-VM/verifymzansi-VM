import { create } from "zustand";
import type { AccountProfile } from "@/types/database";
import type { TrustLevel } from "@/types/enums";
import type { FoundationAccountContext } from "@/lib/foundation/account-context";

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  profile: AccountProfile | null;
  trustLevel: TrustLevel;
  isLoading: boolean;
  foundationContext: FoundationAccountContext | null;

  setUser: (user: AuthUser | null) => void;
  setProfile: (profile: AccountProfile | null) => void;
  setTrustLevel: (level: TrustLevel) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
  applyFoundationContext: (context: FoundationAccountContext | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  trustLevel: 0,
  isLoading: true,
  foundationContext: null,

  setUser: (user) => set({ user, foundationContext: null }),
  setProfile: (profile) => set({ profile, foundationContext: null }),
  setTrustLevel: (trustLevel) => set({ trustLevel }),
  setLoading: (isLoading) => set({ isLoading }),
  applyFoundationContext: (context) =>
    set({
      foundationContext: context,
      user: context
        ? {
            id: context.account_id,
            email: context.email ?? "",
            displayName: context.profile.display_name ?? "Member",
            role: context.staff?.role ?? "member",
          }
        : null,
      // No invented legacy row fields or source-profile fallback during migration.
      profile: null,
      trustLevel: 0,
      isLoading: false,
    }),
  reset: () =>
    set({
      user: null,
      profile: null,
      trustLevel: 0,
      isLoading: false,
      foundationContext: null,
    }),
}));

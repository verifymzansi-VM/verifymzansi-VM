import { create } from "zustand";
import type { SellerProfile } from "@/types/database";
import type { TrustLevel } from "@/types/enums";

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  profile: SellerProfile | null;
  trustLevel: TrustLevel;
  isLoading: boolean;

  setUser: (user: AuthUser | null) => void;
  setProfile: (profile: SellerProfile | null) => void;
  setTrustLevel: (level: TrustLevel) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  trustLevel: 0,
  isLoading: true,

  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setTrustLevel: (trustLevel) => set({ trustLevel }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () =>
    set({
      user: null,
      profile: null,
      trustLevel: 0,
      isLoading: false,
    }),
}));

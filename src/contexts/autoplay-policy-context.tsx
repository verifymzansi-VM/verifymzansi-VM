"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useHoverCapability } from "@/hooks/use-hover-capability";

interface AutoplayPolicyContextValue {
  /**
   * When true, media and carousels in the subtree must not start or advance
   * automatically — playback only starts from an explicit user action
   * (tap-to-play). Media still lazy-loads so posters/previews render as usual.
   */
  disableAutoplay: boolean;
}

const DEFAULT_POLICY: AutoplayPolicyContextValue = { disableAutoplay: false };

const AutoplayPolicyContext = createContext<AutoplayPolicyContextValue>(DEFAULT_POLICY);

/**
 * Reads the current autoplay policy. Defaults to `disableAutoplay: false`
 * (autoplay allowed) when no provider is present, so existing pages keep
 * their behaviour unless they explicitly opt out.
 */
export function useAutoplayPolicy(): AutoplayPolicyContextValue {
  return useContext(AutoplayPolicyContext);
}

interface AutoplayPolicyProviderProps {
  disableAutoplay: boolean;
  children: ReactNode;
}

/** Explicitly sets the autoplay policy for a subtree. */
export function AutoplayPolicyProvider({ disableAutoplay, children }: AutoplayPolicyProviderProps) {
  const value = useMemo<AutoplayPolicyContextValue>(() => ({ disableAutoplay }), [disableAutoplay]);
  return <AutoplayPolicyContext.Provider value={value}>{children}</AutoplayPolicyContext.Provider>;
}

/**
 * Disables all autoplay (ambient/viewport video playback and auto-advancing
 * carousels) for the subtree on mobile browsers — touch devices without a
 * hover-capable, fine pointer. Desktop behaviour is unchanged: videos still
 * auto-play muted and carousels still auto-advance there.
 */
export function DisableMobileAutoplay({ children }: { children: ReactNode }) {
  const canHover = useHoverCapability();
  return <AutoplayPolicyProvider disableAutoplay={!canHover}>{children}</AutoplayPolicyProvider>;
}

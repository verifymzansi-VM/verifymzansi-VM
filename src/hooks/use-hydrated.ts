"use client";

import { useSyncExternalStore } from "react";

function subscribeToHydrationState() {
  return () => {};
}

export function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydrationState,
    () => true,
    () => false
  );
}

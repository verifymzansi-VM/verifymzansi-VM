"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

export type ViewerTheme = "dark" | "light";
export const VIEWER_THEME_KEY = "vm:viewer-theme";
const CHANGE_EVENT = "vm:viewer-theme-change";
let memoryTheme: ViewerTheme = "dark";
let storageBlocked = false;

function snapshot(): ViewerTheme {
  if (storageBlocked) return memoryTheme;
  try {
    const saved = window.localStorage.getItem(VIEWER_THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "dark";
  } catch {
    return memoryTheme;
  }
}

function subscribe(update: () => void) {
  window.addEventListener("storage", update);
  window.addEventListener(CHANGE_EVENT, update);
  return () => {
    window.removeEventListener("storage", update);
    window.removeEventListener(CHANGE_EVENT, update);
  };
}

const AppearanceContext = createContext<{
  theme: ViewerTheme;
  toggle: () => void;
} | null>(null);

/** Only the viewer and its portalled controls inherit this appearance. */
export function ViewerAppearanceProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark" as const);
  function toggle() {
    memoryTheme = theme === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(VIEWER_THEME_KEY, memoryTheme);
    } catch {
      storageBlocked = true;
      // A blocked preference store still allows changing appearance this visit.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return (
    <AppearanceContext.Provider value={{ theme, toggle }}>{children}</AppearanceContext.Provider>
  );
}

export function useViewerAppearance() {
  return useContext(AppearanceContext);
}

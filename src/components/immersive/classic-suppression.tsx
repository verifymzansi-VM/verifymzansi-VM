"use client";

import { createContext, useContext } from "react";

/**
 * When the desktop viewer takes over a post page, the server-rendered classic
 * page underneath must not record views or contact clicks of its own. The gate
 * decides this during its first browser render, before any child effect runs,
 * so children read it at effect time through this getter.
 */
const ClassicSuppressionContext = createContext<() => boolean>(() => false);

export const ClassicSuppressionProvider = ClassicSuppressionContext.Provider;

export function useClassicSuppressed() {
  return useContext(ClassicSuppressionContext);
}

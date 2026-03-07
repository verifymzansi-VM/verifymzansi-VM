"use client";

import { useState, useEffect, useRef, useMemo } from "react";

/**
 * Returns a debounced version of the value that only updates
 * after the specified delay has passed without changes.
 *
 * @param value - The value to debounce
 * @param delayMs - Debounce delay in milliseconds (default: 300)
 */
export function useDebounceValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Returns a debounced callback that delays invocation until
 * `delayMs` milliseconds have passed since the last call.
 *
 * The returned function is stable (won't change between renders).
 */
export type DebouncedCallback<Args extends unknown[]> = ((...args: Args) => void) & {
  cancel: () => void;
};

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs = 300
): DebouncedCallback<Args> {
  const callbackRef = useRef(callback);

  // Keep the ref in sync with the latest callback without triggering re-renders.
  // Using useEffect avoids the react-hooks/refs "cannot update ref during render" lint error.
  useEffect(() => {
    callbackRef.current = callback;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup pending timer on unmount to prevent firing against unmounted component
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return useMemo(() => {
    const debounced = ((...args: Args) => {
      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delayMs);
    }) as DebouncedCallback<Args>;

    debounced.cancel = cancel;

    return debounced;
  }, [delayMs]);
}

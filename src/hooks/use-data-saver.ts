"use client";

import { useEffect, useState } from "react";

interface NetworkInformationLike {
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

const REDUCED_DATA_QUERY = "(prefers-reduced-data: reduce)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function getConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

function getReducedDataQuery(): MediaQueryList | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return window.matchMedia(REDUCED_DATA_QUERY);
}

/**
 * Reads the visitor's data-saving preference right now: the `Save-Data`
 * setting (`navigator.connection.saveData`) or `prefers-reduced-data`, where
 * the browser supports them. Always false on the server.
 */
export function readDataSaverPreference(): boolean {
  if (getConnection()?.saveData) return true;
  return Boolean(getReducedDataQuery()?.matches);
}

/**
 * True when a video must not start by itself: the visitor saves data or
 * prefers reduced motion. Explicit presses on Play or Preview still work.
 */
export function prefersNoVideoAutoplay(): boolean {
  if (readDataSaverPreference()) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Returns true when the user agent has enabled a data-saving preference
 * (the `Save-Data` client hint, exposed via `navigator.connection.saveData`,
 * or the `prefers-reduced-data` media feature).
 *
 * Used to suppress media autoplay and other non-essential network work.
 * Hydration-safe: defaults to false on the server and first client render.
 */
export function useDataSaver(): boolean {
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    const connection = getConnection();
    const reducedData = getReducedDataQuery();

    const update = () => setSaveData(readDataSaverPreference());
    update();

    connection?.addEventListener?.("change", update);
    reducedData?.addEventListener?.("change", update);
    return () => {
      connection?.removeEventListener?.("change", update);
      reducedData?.removeEventListener?.("change", update);
    };
  }, []);

  return saveData;
}

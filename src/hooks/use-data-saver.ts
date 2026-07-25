"use client";

import { useEffect, useState } from "react";

interface NetworkInformationLike {
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

function getConnection(): NetworkInformationLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

/**
 * Returns true when the user agent has enabled a data-saving preference
 * (the `Save-Data` client hint, exposed via `navigator.connection.saveData`).
 *
 * Used to suppress media autoplay and other non-essential network work.
 * Hydration-safe: defaults to false on the server and first client render.
 */
export function useDataSaver(): boolean {
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    const connection = getConnection();
    if (!connection) return;

    const update = () => setSaveData(Boolean(connection.saveData));
    update();

    connection.addEventListener?.("change", update);
    return () => connection.removeEventListener?.("change", update);
  }, []);

  return saveData;
}

"use client";

import { useEffect } from "react";
import { useMarketplaceStore } from "@/stores";

export function MzansiBusinessFilterSync() {
  const setActiveArea = useMarketplaceStore((state) => state.setActiveArea);

  useEffect(() => {
    setActiveArea("MZANSI_BUSINESS");
  }, [setActiveArea]);

  return null;
}

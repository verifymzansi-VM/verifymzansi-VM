"use client";
import { useRef } from "react";
import type { MarketplaceArea } from "@/types/enums";
export function usePostActionFields() {
  const receipt = useRef<{ key: string; id: string } | null>(null);
  return (
    id: string,
    revision: number | undefined,
    action: string,
    area: MarketplaceArea | undefined,
    contentType: "listing" | "business" | "promotion" | undefined
  ): {
    operationId?: string;
    expectedRevision?: number;
    area?: MarketplaceArea;
    contentType?: "listing" | "business" | "promotion";
  } => {
    if (!Number.isInteger(revision) || !revision || !area || !contentType)
      throw new Error("Reload your posts before continuing");
    const key = `${id}:${revision}:${action}`;
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() };
    return { operationId: receipt.current.id, expectedRevision: revision, area, contentType };
  };
}

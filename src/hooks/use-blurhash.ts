"use client";

import { useMemo } from "react";
import { decode } from "blurhash";

/** Module-level cache — survives re-renders, shared across instances. */
const blurHashCache = new Map<string, string>();

/**
 * Decode a BlurHash string into a tiny data-URL that can be used as a
 * CSS `background-image` placeholder (LQIP).
 *
 * Returns an empty string if the hash is falsy or invalid.
 *
 * @param hash   - BlurHash string (e.g. "LEHV6nWB2yk8pyo0adR*.7kCMdnj")
 * @param width  - Decode canvas width (default 32 — tiny is fine for blur)
 * @param height - Decode canvas height (default 32)
 * @param punch  - Brightness factor (default 1)
 */
export function useBlurHash(
  hash: string | null | undefined,
  width: number = 32,
  height: number = 32,
  punch: number = 1
): string {
  return useMemo(() => {
    if (!hash) return "";

    const cacheKey = `${hash}:${width}:${height}:${punch}`;
    const cached = blurHashCache.get(cacheKey);
    if (cached) return cached;

    try {
      const pixels = decode(hash, width, height, punch);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
      const url = canvas.toDataURL("image/png");
      blurHashCache.set(cacheKey, url);
      return url;
    } catch {
      return "";
    }
  }, [hash, width, height, punch]);
}

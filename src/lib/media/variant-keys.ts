/** Shared by image generation and cleanup, including the scheduled Worker. */
export const VARIANT_WIDTHS = [400, 800, 1600] as const;

export function variantKeyFor(originalKey: string, width: number): string {
  const dot = originalKey.lastIndexOf(".");
  const stem = dot > 0 ? originalKey.slice(0, dot) : originalKey;
  return `${stem}.w${width}.webp`;
}

const VARIANT_SOURCE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

/** Missing variants are safe to delete; videos and existing variants stay unchanged. */
export function withVariantKeys(key: string): string[] {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (!VARIANT_SOURCE_EXTS.has(ext) || /\.w\d+\.webp$/.test(key)) return [key];
  return [key, ...VARIANT_WIDTHS.map((width) => variantKeyFor(key, width))];
}

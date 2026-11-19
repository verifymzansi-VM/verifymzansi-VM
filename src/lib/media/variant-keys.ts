/** Shared by image generation and cleanup, including the scheduled Worker. */
export const VARIANT_WIDTHS = [400, 800, 1600] as const;

export function variantKeyFor(originalKey: string, width: number): string {
  const dot = originalKey.lastIndexOf(".");
  const stem = dot > 0 ? originalKey.slice(0, dot) : originalKey;
  return `${stem}.w${width}.webp`;
}

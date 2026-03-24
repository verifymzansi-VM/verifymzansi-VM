import type { MarketplaceArea, PlanTier } from "@/types/enums";

function hashSegment(seed: number, input: string): string {
  let hash = seed >>> 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

export function getStablePlanId(area: MarketplaceArea, tier: PlanTier): string {
  const input = `${area}:${tier}`;
  const chars = [
    hashSegment(0x811c9dc5, input),
    hashSegment(0x9e3779b9, input),
    hashSegment(0xc2b2ae35, input),
    hashSegment(0x27d4eb2f, input),
  ]
    .join("")
    .slice(0, 32)
    .split("");

  // Force RFC 4122 version/variant bits so zod's UUID validation accepts the deterministic ID.
  chars[12] = "4";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);

  const hex = chars.join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20, 32)}`;
}

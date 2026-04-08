function toPercentStep(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function getFocalPositionClassName(
  focalX?: number | null,
  focalY?: number | null
): string | undefined {
  if (focalX == null || focalY == null) return undefined;
  const x = toPercentStep(focalX);
  const y = toPercentStep(focalY);
  return `focal-pos-x-${x} focal-pos-y-${y}`;
}

export function getProgressWidthClassName(progress?: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  return `progress-w-${clamped}`;
}

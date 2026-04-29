export interface NormalizedPoint {
  x: number;
  y: number;
}

export function clampNormalizedPoint(point: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.round(Math.max(0, Math.min(1, point.x)) * 1000) / 1000,
    y: Math.round(Math.max(0, Math.min(1, point.y)) * 1000) / 1000,
  };
}

export function nudgeNormalizedPoint(
  point: NormalizedPoint,
  key: string,
  step: number
): NormalizedPoint | null {
  if (key === "ArrowLeft") return clampNormalizedPoint({ ...point, x: point.x - step });
  if (key === "ArrowRight") return clampNormalizedPoint({ ...point, x: point.x + step });
  if (key === "ArrowUp") return clampNormalizedPoint({ ...point, y: point.y - step });
  if (key === "ArrowDown") return clampNormalizedPoint({ ...point, y: point.y + step });
  return null;
}

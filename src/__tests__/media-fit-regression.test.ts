import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.join(process.cwd(), "src");
const ALLOWLIST = new Set([
  path.join("components", "showrooms", "showroom-card-carousel.tsx"),
  path.join("components", "ui", "focal-point-picker.tsx"),
  path.join("components", "ui", "media-crop-preview.tsx"),
  path.join("components", "ui", "media-upload.tsx"),
  path.join("components", "ui", "profile-video-player.tsx"),
  path.join("components", "ui", "video-card-player.tsx"),
  path.join("components", "ui", "video-frame-selector.tsx"),
  path.join("components", "ui", "video-with-poster.tsx"),
]);
const CROP_PATTERN = /\bobject-cover\b|fitStrategy="cover"/;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry) || /\.test\./.test(entry)) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe("media fit regression guard", () => {
  it("keeps cover-cropping restricted to the explicit allowlist", () => {
    const violations = collectSourceFiles(SOURCE_ROOT)
      .map((fullPath) => {
        const relativePath = path.relative(SOURCE_ROOT, fullPath);
        const content = readFileSync(fullPath, "utf8");
        return CROP_PATTERN.test(content) && !ALLOWLIST.has(relativePath) ? relativePath : null;
      })
      .filter((value): value is string => value !== null);

    expect(violations).toEqual([]);
  });
});

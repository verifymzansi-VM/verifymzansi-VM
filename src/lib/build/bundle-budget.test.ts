import { describe, expect, it } from "vitest";
import { collectAppRouteBundles, routeFromAppChunk } from "./bundle-budget";

describe("bundle budget app route chunks", () => {
  const appChunksDir = "C:/repo/.next/static/chunks/app";

  it("maps Next app route page chunks to public routes", () => {
    expect(routeFromAppChunk(appChunksDir, "C:/repo/.next/static/chunks/app/page-abc123.js")).toBe(
      "/"
    );
    expect(
      routeFromAppChunk(
        appChunksDir,
        "C:/repo/.next/static/chunks/app/(marketplace)/mzansi-market/page-def456.js"
      )
    ).toBe("/mzansi-market");
    expect(
      routeFromAppChunk(
        appChunksDir,
        "C:/repo/.next/static/chunks/app/tourism-events/[id]/page-fed789.js"
      )
    ).toBe("/tourism-events/[id]");
  });

  it("collects route bundles without counting unrelated async chunks", () => {
    const bundles = collectAppRouteBundles(
      [
        "C:/repo/.next/static/chunks/app/page-abc123.js",
        "C:/repo/.next/static/chunks/app/(marketplace)/mzansi-market/page-def456.js",
        "C:/repo/.next/static/chunks/e99863e0.lazy-upload.js",
      ],
      appChunksDir,
      (filePath) => (filePath.includes("mzansi-market") ? 49 * 1024 : 12 * 1024)
    );

    expect(bundles).toEqual([
      {
        route: "/",
        sizeBytes: 12 * 1024,
        files: ["C:/repo/.next/static/chunks/app/page-abc123.js"],
      },
      {
        route: "/mzansi-market",
        sizeBytes: 49 * 1024,
        files: ["C:/repo/.next/static/chunks/app/(marketplace)/mzansi-market/page-def456.js"],
      },
    ]);
  });
});

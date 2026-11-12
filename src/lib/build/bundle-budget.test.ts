import { describe, expect, it } from "vitest";
import { collectAppRouteBundles, routeClientChunkFiles, routeFromAppChunk } from "./bundle-budget";

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

describe("route client chunk files", () => {
  it("lists each script path once, relative to .next, and skips chunk ids", () => {
    expect(
      routeClientChunkFiles({
        clientModules: {
          a: { chunks: ["12", "static/chunks/12-abc.js", "34", "/_next/static/chunks/34-def.js"] },
          b: { chunks: ["12", "static/chunks/12-abc.js"] },
          c: { chunks: [] },
          d: {},
        },
      })
    ).toEqual(["static/chunks/12-abc.js", "static/chunks/34-def.js"]);
  });

  it("decodes URL-encoded route folders to their names on disk", () => {
    expect(
      routeClientChunkFiles({
        clientModules: { a: { chunks: ["9", "static/chunks/app/listing/%5Bid%5D/page-1.js"] } },
      })
    ).toEqual(["static/chunks/app/listing/[id]/page-1.js"]);
  });

  it("returns nothing for a manifest without client modules", () => {
    expect(routeClientChunkFiles({})).toEqual([]);
  });
});

#!/usr/bin/env node
// Prepares the Workers build of @vercel/og for the offload Worker
// (wrangler.offload.toml runs this as its build command).
//
// Next ships the Workers ("edge") build of @vercel/og, but it loads its
// fallback font with fetch(new URL("./Geist-Regular.ttf", import.meta.url)),
// which a Worker cannot do. OpenNext fixes this for the main Worker by loading
// the font as a bundled module instead; this script applies the same change
// to a copy in .wrangler/offload-og/, which wrangler.offload.toml aliases in.
// The library, its WebAssembly and the font are copied unchanged, so cards
// are drawn exactly as the main Worker drew them.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextPackage = createRequire(path.join(root, "package.json")).resolve("next/package.json");
const source = path.join(path.dirname(nextPackage), "dist", "compiled", "@vercel", "og");
const OFFLOAD_OG_DIR = path.join(root, ".wrangler", "offload-og");

const FONT_FETCH =
  'var fallbackFont = fetch(\n  new URL("./Geist-Regular.ttf", import.meta.url)\n).then((res) => res.arrayBuffer());';
// The replacement OpenNext makes (patches/ast/vercel-og.js).
const FONT_IMPORT = `async function getFallbackFont() {
  return (await import("./Geist-Regular.ttf.bin")).default;
}
var fallbackFont = getFallbackFont();`;

export function prepareOffloadOg() {
  const library = readFileSync(path.join(source, "index.edge.js"), "utf8").replace(/\r\n/g, "\n");
  const parts = library.split(FONT_FETCH);
  assert.equal(parts.length, 2, "@vercel/og font loading changed; review this patch");
  for (const wasm of ["resvg.wasm", "yoga.wasm"])
    assert.ok(library.includes(`"./${wasm}?module"`), `@vercel/og no longer imports ${wasm}`);
  rmSync(OFFLOAD_OG_DIR, { recursive: true, force: true });
  mkdirSync(OFFLOAD_OG_DIR, { recursive: true });
  writeFileSync(path.join(OFFLOAD_OG_DIR, "index.edge.js"), parts.join(FONT_IMPORT));
  copyFileSync(path.join(source, "resvg.wasm"), path.join(OFFLOAD_OG_DIR, "resvg.wasm"));
  copyFileSync(path.join(source, "yoga.wasm"), path.join(OFFLOAD_OG_DIR, "yoga.wasm"));
  copyFileSync(
    path.join(source, "Geist-Regular.ttf"),
    path.join(OFFLOAD_OG_DIR, "Geist-Regular.ttf.bin")
  );
  copyFileSync(path.join(source, "LICENSE"), path.join(OFFLOAD_OG_DIR, "LICENSE"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, "prepare-offload-worker takes no arguments");
  prepareOffloadOg();
  console.log("Prepared @vercel/og for the offload Worker.");
}

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const handlerPath = path.join(repoRoot, ".open-next", "server-functions", "default", "handler.mjs");

if (!fs.existsSync(handlerPath)) {
  console.log("- OpenNext handler not found; skipping @vercel/og path patch.");
  process.exit(0);
}

const original = fs.readFileSync(handlerPath, "utf8");
const absoluteOgAssetPattern =
  /(["'])[^"']*\/\.open-next\/server-functions\/default\/node_modules\/next\/dist\/compiled\/@vercel\/og\/([^"']+)\1/g;

const patched = original.replace(
  absoluteOgAssetPattern,
  "$1./node_modules/next/dist/compiled/@vercel/og/$2$1"
);

if (patched !== original) {
  fs.writeFileSync(handlerPath, patched, "utf8");
  console.log("✓ Rewrote absolute @vercel/og imports in OpenNext handler for Wrangler deploy.");
} else {
  console.log("- No absolute @vercel/og asset imports detected in OpenNext handler.");
}

// Ensure .wasm files are copied into the .open-next tree so Wrangler can resolve them
const ogSrc = path.join(repoRoot, "node_modules", "next", "dist", "compiled", "@vercel", "og");
const ogDst = path.join(repoRoot, ".open-next", "server-functions", "default", "node_modules", "next", "dist", "compiled", "@vercel", "og");

for (const name of ["yoga.wasm", "resvg.wasm"]) {
  const src = path.join(ogSrc, name);
  const dst = path.join(ogDst, name);
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log(`✓ Copied ${name} into .open-next for Wrangler.`);
  }
}

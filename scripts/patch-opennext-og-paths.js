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

if (patched === original) {
  console.log("- No absolute @vercel/og asset imports detected in OpenNext handler.");
  process.exit(0);
}

fs.writeFileSync(handlerPath, patched, "utf8");
console.log("✓ Rewrote absolute @vercel/og imports in OpenNext handler for Wrangler deploy.");

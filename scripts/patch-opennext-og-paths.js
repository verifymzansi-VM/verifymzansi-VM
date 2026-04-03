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
const ogDst = path.join(repoRoot, ".open-next", "server-functions", "default", "node_modules", "next", "dist", "compiled", "@vercel", "og");

// Resolve the real path of the `next` package to handle pnpm symlinks
function findOgDir() {
  // 1. Try resolving via require.resolve (works with pnpm symlinks)
  try {
    const nextPkgJson = require.resolve("next/package.json", { paths: [repoRoot] });
    const candidate = path.join(path.dirname(nextPkgJson), "dist", "compiled", "@vercel", "og");
    if (fs.existsSync(path.join(candidate, "yoga.wasm"))) return candidate;
  } catch (_) {}
  // 2. Try the direct node_modules path (standard layout)
  const direct = path.join(repoRoot, "node_modules", "next", "dist", "compiled", "@vercel", "og");
  if (fs.existsSync(path.join(direct, "yoga.wasm"))) return direct;
  // 3. Try following the symlink manually
  try {
    const real = fs.realpathSync(path.join(repoRoot, "node_modules", "next"));
    const candidate = path.join(real, "dist", "compiled", "@vercel", "og");
    if (fs.existsSync(path.join(candidate, "yoga.wasm"))) return candidate;
  } catch (_) {}
  return null;
}

const ogSrc = findOgDir();
if (!ogSrc) {
  console.error("✗ Could not locate @vercel/og wasm files in the next package — Wrangler deploy will likely fail.");
} else {
  for (const name of ["yoga.wasm", "resvg.wasm"]) {
    const src = path.join(ogSrc, name);
    const dst = path.join(ogDst, name);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      console.log(`✓ Copied ${name} into .open-next for Wrangler.`);
    } else if (!fs.existsSync(src)) {
      console.warn(`⚠ ${name} not found at ${src}`);
    } else {
      console.log(`- ${name} already exists at destination.`);
    }
  }
}

#!/usr/bin/env node
// Fails when the build's app-paths manifest lacks a required route
// (scripts/lib/built-routes.mjs). Usage: node scripts/check-built-routes.mjs [manifest]
import { readFileSync } from "node:fs";
import { missingBuiltRoutes, REQUIRED_BUILT_ROUTES } from "./lib/built-routes.mjs";

const file = process.argv[2] ?? ".next/server/app-paths-manifest.json";
const missing = missingBuiltRoutes(JSON.parse(readFileSync(file, "utf8")));
if (missing.length > 0) {
  for (const route of missing) console.error(`::error::Built route missing: ${route}`);
  process.exit(1);
}
console.log(`All ${REQUIRED_BUILT_ROUTES.length} required routes are in ${file}.`);

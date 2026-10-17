#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { checkIsolation, summarizeRegionSamples } from "./lib/backend-foundation.mjs";

const [mode, file, environment] = process.argv.slice(2);
if (!["isolation", "regions"].includes(mode) || !file || (mode === "isolation" && !environment)) {
  console.error(
    "Usage: node scripts/check-backend-foundation.mjs isolation <manifest.json> <environment> | regions <samples.json>"
  );
  process.exit(2);
}
try {
  const input = JSON.parse(readFileSync(file, "utf8"));
  const result =
    mode === "isolation"
      ? checkIsolation(input, environment)
      : {
          status: "INCOMPLETE",
          scope: "Offline observation summary; never selects a region or authorizes provisioning",
          groups: summarizeRegionSamples(input),
        };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "PASS" ? 0 : 1;
} catch {
  // Do not print caller-controlled JSON or file contents, which could contain secrets.
  console.error("Invalid input or unreadable file");
  process.exitCode = 2;
}

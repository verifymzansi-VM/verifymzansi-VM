import nextEnv from "@next/env";
import { existsSync, writeFileSync } from "node:fs";
import { cloudflareBuildFingerprint } from "./lib/cloudflare-build-fingerprint.mjs";
nextEnv.loadEnvConfig(process.cwd());
if (!existsSync(".open-next/worker.js") || !existsSync(".open-next/assets"))
  throw new Error("Worker output is missing");
writeFileSync(
  ".open-next/build-fingerprint.json",
  JSON.stringify({
    schemaVersion: 1,
    fingerprint: cloudflareBuildFingerprint(process.cwd(), process.env),
  }) + "\n"
);
console.log("Worker build source and public configuration fingerprint recorded.");

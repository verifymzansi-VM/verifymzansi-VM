#!/usr/bin/env node

const { execSync } = require("node:child_process");

const isWorkersCi = (() => {
  const value = process.env.WORKERS_CI;
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
})();

const command = isWorkersCi ? "pnpm run build:cloudflare" : "pnpm exec next build --webpack";

if (process.argv.includes("--print")) {
  console.log(command);
  process.exit(0);
}

console.log(
  isWorkersCi
    ? "[build] Cloudflare Workers Builds detected; running OpenNext Cloudflare build."
    : "[build] Running standard Next.js webpack production build."
);

execSync(command, {
  stdio: "inherit",
});

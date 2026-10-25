import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "smol-toml";
import { createCloudflareStartupFixture } from "./lib/cloudflare-startup-fixture.mjs";

// This job uses a fresh Actions checkout and no production credentials. Never
// replace an operator's local environment file with synthetic test settings.
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  existsSync(".env.production.local") ||
  existsSync(".env.local")
)
  throw new Error("Runtime fixture requires a fresh isolated Actions checkout");
const config = parse(readFileSync("wrangler.toml", "utf8"));
const publicSettings = Object.fromEntries(
  Object.entries(config.vars).filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
);
const values = { ...createCloudflareStartupFixture(publicSettings), ...publicSettings };
writeFileSync(
  ".env.production.local",
  Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n") + "\n",
  { flag: "wx", mode: 0o600 }
);
console.log(
  "Isolated Worker fixture prepared with public build configuration and synthetic private bindings."
);

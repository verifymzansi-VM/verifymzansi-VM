import { readFile, appendFile } from "node:fs/promises";
import { parse } from "smol-toml";

// Default: production. `--env=staging` exports the staging copy's public
// settings instead (M0.15b); no other environment exists.
const args = process.argv.slice(2);
const target = args.length === 0 ? "production" : args[0] === "--env=staging" ? "staging" : null;
if (!target || args.length > 1 || process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV)
  throw new Error("Public build settings require an isolated Actions runner");
const config = parse(await readFile("wrangler.toml", "utf8"));
const vars = config.env?.[target]?.vars;
if (!vars || typeof vars !== "object") throw new Error(`Missing ${target} bindings`);
const entries = Object.entries(vars).filter(([name]) => name.startsWith("NEXT_PUBLIC_"));
if (!entries.length) throw new Error("Missing public build settings");
for (const [name, value] of entries) {
  if (!/^[A-Z][A-Z0-9_]+$/.test(name) || typeof value !== "string" || /[\r\n]/.test(value))
    throw new Error("Invalid public build setting name or format");
  if (process.env[name] && process.env[name] !== value)
    throw new Error(`Build/binding mismatch: ${name}`);
}
await appendFile(
  process.env.GITHUB_ENV,
  entries.map(([name, value]) => `${name}=${value}`).join("\n") + "\n"
);
console.log("Public build setting names aligned: " + entries.map(([name]) => name).join(", "));

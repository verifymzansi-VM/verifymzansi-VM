import { readFile, appendFile } from "node:fs/promises";
import { parse } from "smol-toml";

if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV)
  throw new Error("Public build settings require an isolated Actions runner");
const config = parse(await readFile("wrangler.toml", "utf8"));
const vars = config.env?.production?.vars;
if (!vars || typeof vars !== "object") throw new Error("Missing production bindings");
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

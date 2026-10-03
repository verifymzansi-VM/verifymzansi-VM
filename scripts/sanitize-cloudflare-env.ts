import { readFile, writeFile } from "node:fs/promises";
import { sanitizeCloudflareEnvModule } from "./lib/cloudflare-env-policy";
async function main() {
  if (process.argv.length > 2) throw new Error("sanitize:cloudflare-env accepts no flags");
  const file = ".open-next/cloudflare/next-env.mjs";
  const result = sanitizeCloudflareEnvModule(await readFile(file, "utf8"));
  await writeFile(file, result.source);
  // Never log values from the original module.
  process.stdout.write(
    `Cloudflare fallback env: retained public settings; removed ${result.removed.length} private/config names. Runtime bindings required.\n`
  );
}
main().catch(() => {
  process.stderr.write(
    "Cloudflare env sanitization failed: missing/malformed generated module or unsupported argument\n"
  );
  process.exitCode = 1;
});

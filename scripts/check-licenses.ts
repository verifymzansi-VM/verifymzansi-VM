import { readFileSync } from "node:fs";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
import { validateLicenseReport } from "./lib/license-policy";
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--"))
    throw new Error("licenses:check accepts no flags");
  const [command, args] = pnpmInvocation(["licenses", "list", "--json"]);
  const result = await execute(command, args, 120_000);
  if (result.status !== "PASS")
    throw new Error(`License listing ${result.status}: ${result.output}`);
  const report: unknown = JSON.parse(result.output);
  let notice = "";
  try {
    notice = readFileSync("public/vendor/ffmpeg-core/NOTICE.txt", "utf8");
  } catch {
    /* Policy reports missing evidence. */
  }
  const errors = validateLicenseReport(report, notice);
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("License policy check passed.\n");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

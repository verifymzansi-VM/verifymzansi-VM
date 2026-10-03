import { readFile, stat, mkdir } from "node:fs/promises";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
import { validateDuplication, type DuplicationBaseline } from "./lib/duplication-policy";
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--"))
    throw new Error("jscpd:check accepts no flags");
  await mkdir("tmp/jscpd", { recursive: true });
  const started = Date.now();
  const [command, args] = pnpmInvocation([
    "exec",
    "jscpd",
    "--config",
    ".jscpd.json",
    "src",
    "scripts",
    "workers",
  ]);
  const result = await execute(command, args, 600_000);
  if (result.status !== "PASS")
    throw new Error(`Duplication scan ${result.status}: ${result.output}`);
  const report: unknown = JSON.parse(await readFile("tmp/jscpd/jscpd-report.json", "utf8"));
  const baseline = JSON.parse(
    await readFile("scripts/audit-baselines/duplication.json", "utf8")
  ) as DuplicationBaseline;
  const errors = validateDuplication(
    report,
    baseline,
    (await stat("tmp/jscpd/jscpd-report.json")).mtimeMs,
    started,
    process.cwd()
  );
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("Duplication baseline verified; no new findings or budget regression.\n");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { mkdir, writeFile } from "node:fs/promises";
import { dependencyAuditVerdict } from "./dependency-audit-policy";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
async function main() {
  await mkdir("tmp/dependency-audit", { recursive: true });
  const includeDev = process.argv.includes("--all");
  const args = ["audit", "--json", "--audit-level=low", ...(includeDev ? [] : ["--prod"])];
  let output = "";
  let status: number | null = null;
  let assessment = "UNAVAILABLE";
  if (process.argv.slice(2).some((arg) => !["--", "--all"].includes(arg)))
    output = JSON.stringify({ error: "Unsupported dependency audit argument" });
  else {
    const [command, invocation] = pnpmInvocation(args);
    const run = await execute(command, invocation, 120_000);
    output = run.output;
    status = run.exitCode;
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = null;
    }
    const networkError =
      /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|network timeout/i.test(output);
    const verdict =
      networkError || ["UNAVAILABLE", "TIMED_OUT"].includes(run.status)
        ? "INVALID"
        : dependencyAuditVerdict(status, parsed);
    assessment = verdict === "INVALID" ? "UNAVAILABLE" : verdict;
  }
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = { error: "Malformed audit output", diagnostics: output };
  }
  const report = JSON.stringify(
    {
      schemaVersion: 1,
      scope: includeDev ? "all" : "production",
      assessment,
      exitCode: status,
      output: parsed,
    },
    null,
    2
  );
  await writeFile(`tmp/dependency-audit/audit-${id}.json`, report);
  await writeFile("tmp/dependency-audit/latest.json", report);
  process.stdout.write(
    `Dependency audit: ${assessment}; evidence tmp/dependency-audit/latest.json\n`
  );
  if (assessment !== "PASS") process.exitCode = assessment === "FAIL" ? 1 : 2;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});

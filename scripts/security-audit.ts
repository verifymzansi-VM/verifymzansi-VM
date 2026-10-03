import { mkdir, writeFile } from "node:fs/promises";
import { dependencyAuditVerdict } from "./dependency-audit-policy";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
import { assessPatchedAudit, verifyBracesBackport } from "./lib/braces-backport";
async function main() {
  await mkdir("tmp/dependency-audit", { recursive: true });
  const includeDev = process.argv.includes("--all");
  const args = ["audit", "--json", "--audit-level=low", ...(includeDev ? [] : ["--prod"])];
  let output = "";
  let status: number | null = null;
  let assessment = "UNAVAILABLE";
  let backport: Awaited<ReturnType<typeof verifyBracesBackport>> | undefined;
  let mitigation: ReturnType<typeof assessPatchedAudit> | undefined;
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
    if (verdict !== "INVALID") {
      backport = await verifyBracesBackport();
      mitigation = assessPatchedAudit(status, parsed, backport);
    }
    assessment =
      mitigation?.assessment === "INVALID" || verdict === "INVALID"
        ? "UNAVAILABLE"
        : (mitigation?.assessment ?? verdict);
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
      backport,
      mitigation,
    },
    null,
    2
  );
  await writeFile(`tmp/dependency-audit/audit-${id}.json`, report);
  await writeFile("tmp/dependency-audit/latest.json", report);
  process.stdout.write(
    `Dependency audit: ${assessment}; evidence tmp/dependency-audit/latest.json\n`
  );
  if (mitigation?.mitigated.length)
    process.stdout.write(
      "WARN: Registry still lists braces 3.0.3; reviewed upstream depth-guard backport is installed and verified. Raw advisory retained in evidence.\n"
    );
  if (!["PASS", "WARN"].includes(assessment)) process.exitCode = assessment === "FAIL" ? 1 : 2;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});

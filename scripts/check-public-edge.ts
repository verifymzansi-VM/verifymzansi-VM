import { appendFileSync } from "node:fs";
import { classifyPublicEdge, publicEdgeReport } from "./lib/public-edge";
import { securityHeaderProblems } from "./lib/security-header-policy.mjs";

function record(name: "GITHUB_OUTPUT" | "GITHUB_STEP_SUMMARY", text: string) {
  const file = process.env[name];
  if (file) appendFileSync(file, `${text}\n`);
}

async function main() {
  const url = new URL(process.env.APP_URL || "https://verifymzansi.com");
  if (url.origin !== "https://verifymzansi.com" || url.username || url.password)
    throw new Error("Invalid public edge target");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  let verdict = classifyPublicEdge(response.status, response.headers, body);
  // CSP (frame-ancestors, object-src), nosniff, X-Frame-Options and HSTS.
  const headerProblems = verdict === "pass" ? securityHeaderProblems(response.headers) : [];
  if (headerProblems.length > 0) verdict = "fail";
  const report = publicEdgeReport(verdict, response.status, headerProblems);
  console.log(report.line);
  record("GITHUB_OUTPUT", `result=${verdict}`);
  record("GITHUB_STEP_SUMMARY", report.summary);
  process.exitCode = report.exitCode;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Public edge probe failed");
  record("GITHUB_OUTPUT", "result=fail");
  record("GITHUB_STEP_SUMMARY", "Public edge: FAIL (no answer)");
  process.exitCode = 1;
});

import { checks, type SmokeCheck } from "../src/lib/monitoring/smoke-contract";
export { checks, type SmokeCheck } from "../src/lib/monitoring/smoke-contract";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const baseUrl =
  process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function runCheck(
  check: SmokeCheck,
  options?: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<void> {
  const resolvedBaseUrl = options?.baseUrl ?? baseUrl;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const url = `${resolvedBaseUrl}${check.path}`;
  const method = check.method ?? "GET";
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    method,
    headers: check.headers,
    body:
      typeof check.body === "string" || check.body === undefined
        ? check.body
        : JSON.stringify(check.body),
  });

  if (!check.expectStatuses.includes(response.status)) {
    throw new Error(
      `${check.name} failed with status ${response.status}; expected one of ${check.expectStatuses.join(
        ", "
      )}`
    );
  }

  if (check.validateJsonStatusKey) {
    const json = (await response.json()) as { status?: string };
    if (!json.status) {
      throw new Error(`${check.name} missing 'status' key in JSON response`);
    }
    if (response.status !== 200 || json.status !== "ok")
      throw new Error(`${check.name} is degraded; smoke checks do not establish readiness`);
  }

  console.log(`  [OK] ${check.name} (${response.status})`);
}

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg !== "--"))
    throw new Error("Unsupported smoke argument");
  console.log("Running smoke checks...");
  console.log(`Target base URL: ${baseUrl}`);

  for (const check of checks) {
    await runCheck(check);
  }

  console.log("Smoke checks passed.");
}

const isMainModule =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv.length > 1 &&
  import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMainModule) {
  main().catch((error) => {
    console.error("Smoke checks failed:", error);
    process.exit(1);
  });
}

import { loadEnvConfig } from "@next/env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { verifyFoundationDeploymentConnection } from "../src/lib/foundation/deployment-connection";
import { verifyFoundationGateway } from "../src/lib/foundation/gateway-readiness";
import { createCloudflareRequest } from "./lib/cloudflare-api.mjs";
import {
  activeVersionIds,
  inspectPublicBindings,
  inspectSecretBindings,
} from "./lib/cloudflare-deployment-bindings.mjs";
import { readinessUrl, waitForDeploymentHealth } from "./lib/deployment-health";
import { liveCheckFailureReason, retryLiveCheck } from "./lib/live-retry";
import { checkRateLimiterKey } from "./lib/rate-limiter-probe";
import { siteMonitorTransport, waitForLiveHomepage } from "./lib/site-monitor";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";
import {
  verifyFoundationRuntimeApi,
  provisionedFoundationApiManifest,
} from "./lib/foundation-runtime-api.mjs";

loadEnvConfig(process.cwd());

// Read-only live observations. No sign-in, messages, writes, cron triggers,
// deployments, SQL mutations, or customer rows. Reports contain no key values.
type Result = { check: string; status: "PASS" | "FAIL" | "UNAVAILABLE"; detail: string };
const results: Result[] = [];
async function check(name: string, run: () => Promise<void | number>, failure: string) {
  try {
    const attempt = await run();
    results.push({
      check: name,
      status: "PASS",
      detail:
        typeof attempt === "number" && attempt > 1 ? `Verified on attempt ${attempt}` : "Verified",
    });
  } catch {
    results.push({ check: name, status: "FAIL", detail: failure });
  }
}
/** Live checks that go through Workers this deploy has just replaced retry a
 * bounded number of times (see retryLiveCheck). Log lines carry only fixed
 * reasons, and a pass after a retry is reported rather than hidden. */
async function retried(
  name: string,
  run: (onRetry: (attempt: number, error: unknown) => void) => Promise<number>
) {
  try {
    const attempt = await run((failed, error) =>
      console.warn(`${name}: attempt ${failed} failed (${liveCheckFailureReason(error)}); retrying`)
    );
    if (attempt > 1)
      console.log(
        `::warning title=Live check retried::${name} passed on attempt ${attempt}. Earlier attempts failed; watch for an intermittent fault.`
      );
    return attempt;
  } catch (error) {
    console.warn(`${name}: failed (${liveCheckFailureReason(error)})`);
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Unsupported backend alignment argument");
  const connection = verifyFoundationDeploymentConnection(process.env);
  const expected = {
    NEXT_PUBLIC_SUPABASE_URL: connection.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: connection.publishableKey,
    FOUNDATION_SUPABASE_URL: connection.url,
    FOUNDATION_PROJECT_REF: connection.expectedProjectRef,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: connection.publishableKey,
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_REGISTRATION_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_RECOVERY_ENABLED: "true",
    FOUNDATION_PHONE_VERIFICATION_ENABLED: "true",
    // Paid add-on sales stay paused (src/lib/billing/addon-sales.ts); the slice
    // that makes add-ons deliver changes this together with wrangler.toml.
    ADDON_SALES_ENABLED: "false",
  };
  await check(
    "Local production configuration",
    async () => {
      const config = parse(await readFile("wrangler.toml", "utf8"));
      for (const vars of [
        config.vars,
        (config.env as Record<string, { vars: unknown }>)?.production?.vars,
      ]) {
        if (
          !vars ||
          Object.entries(expected).some(
            ([name, value]) => (vars as Record<string, unknown>)[name] !== value
          )
        )
          throw new Error();
      }
    },
    "Local bindings differ from the approved connection; review wrangler.toml and environment aliases."
  );

  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account || !/^[a-f0-9]{32}$/.test(account)) {
    results.push({
      check: "Cloudflare deployed bindings",
      status: "UNAVAILABLE",
      detail: "Cloudflare read credentials are missing or invalid.",
    });
  } else {
    const cf = createCloudflareRequest(token);
    for (const [file, mainApp] of [
      ["wrangler.toml", true],
      ["wrangler.payment-cleanup.toml", false],
      ["wrangler.retention-cleanup.toml", false],
      ["wrangler.rate-limiter.toml", false],
      ["wrangler.ops-jobs.toml", false],
      ["wrangler.site-monitor.toml", false],
    ] as const) {
      const config = parse(await readFile(file, "utf8"));
      const name = config.name;
      if (typeof name !== "string" || !/^verifymzansi(?:-[a-z-]+)?$/.test(name))
        throw new Error("Invalid Worker selector");
      await check(
        `${name}: active versions`,
        async () => {
          const deployment = await cf(
            "GET",
            `/accounts/${account}/workers/scripts/${name}/deployments`
          );
          const ids = activeVersionIds(deployment.deployments);
          for (const id of ids) {
            if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error();
            const version = await cf(
              "GET",
              `/accounts/${account}/workers/scripts/${name}/versions/${id}`
            );
            const bindings = version.resources?.bindings;
            if (
              process.env.DEPLOY_TARGET_SHA &&
              version.annotations?.["workers/tag"] !== process.env.DEPLOY_TARGET_SHA
            )
              throw new Error("Deployed source revision differs");
            const invalid = inspectPublicBindings(
              bindings,
              mainApp
                ? expected
                : Object.fromEntries(
                    Object.entries(config.vars ?? {}).filter(([name]) =>
                      ["DATA_BACKEND", "APP_URL", "ENVIRONMENT"].includes(name)
                    )
                  )
            );
            const secretNames = mainApp
              ? [
                  "FOUNDATION_SUPABASE_SECRET_KEY",
                  "SUPABASE_SERVICE_ROLE_KEY",
                  "FOUNDATION_PHONE_OTP_KEY",
                  "INTERNAL_JOBS_SECRET",
                ]
              : [
                  file === "wrangler.ops-jobs.toml"
                    ? "OPS_JOBS_SECRET"
                    : file === "wrangler.site-monitor.toml"
                      ? "MONITOR_API_KEY"
                      : "WORKER_API_KEY",
                ];
            const secrets = inspectSecretBindings(bindings, secretNames, []);
            const problems = [...invalid, ...secrets.missing, ...secrets.unsafe];
            if (
              !mainApp &&
              file !== "wrangler.rate-limiter.toml" &&
              (!Array.isArray(bindings) ||
                !bindings.some(
                  (binding: { name?: unknown; type?: unknown; service?: unknown }) =>
                    binding.name === "APP" &&
                    binding.type === "service" &&
                    binding.service === "verifymzansi"
                ))
            )
              problems.push("APP");
            if (problems.length) {
              results.push({
                check: `${name}: ${id}`,
                status: "FAIL",
                detail: `Missing or mismatched bindings: ${[...new Set(problems)].join(", ")}`,
              });
              throw new Error();
            }
          }
        },
        "Active deployment does not match the approved project or required secret types, or provider read access is unavailable."
      );
    }
  }
  await check(
    "Supabase gateway and service RPC contract",
    async () => {
      const { serviceOpenapi } = await verifyFoundationGateway(process.env);
      const manifest = JSON.parse(await readFile("database/foundation/api-manifest.json", "utf8"));
      verifyRoleOpenapi(serviceOpenapi, provisionedFoundationApiManifest(manifest), "service_role");
    },
    "Public API read, service credential, function contract or hidden-schema check failed. Review Supabase exposure and key pairing."
  );
  await check(
    "Supabase runtime extension presence and anonymous refusal",
    async () => {
      await verifyFoundationRuntimeApi(connection);
    },
    "An authenticated runtime RPC is missing, publicly callable, or unavailable. Review the ordered runtime updates and authentication boundary."
  );
  await check(
    "Supabase Google sign-in provider",
    async () => {
      const response = await fetch(`${connection.url}/auth/v1/settings`, {
        headers: { apikey: connection.publishableKey },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok || (await response.json())?.external?.google !== true) throw new Error();
    },
    "Google sign-in is disabled or unavailable on the approved Supabase project. Configure the existing OAuth client and its new project callback before claiming auth alignment."
  );
  await check(
    "Live deep readiness",
    () =>
      retried("Live deep readiness", (onRetry) => {
        const monitor = process.env.SITE_MONITOR_API_KEY ? siteMonitorTransport(process.env) : null;
        return waitForDeploymentHealth(monitor?.url ?? readinessUrl("https://verifymzansi.com"), {
          fetchImpl: monitor?.fetcher,
          onRetry,
        });
      }),
    "Live deep readiness is degraded, unavailable or not valid JSON."
  );
  if (!process.env.RATE_LIMITER_API_KEY) {
    results.push({
      check: "Local key against deployed rate limiter",
      status: "UNAVAILABLE",
      detail:
        "Local RATE_LIMITER_API_KEY is absent; remote shared-secret equality was not verified.",
    });
  } else
    await check(
      "Local key against deployed rate limiter",
      () =>
        retried("Local key against deployed rate limiter", (onRetry) =>
          retryLiveCheck(() => checkRateLimiterKey(process.env.RATE_LIMITER_API_KEY ?? ""), {
            onRetry,
          })
        ),
      "The local RATE_LIMITER_API_KEY is missing, rejected or could not be verified against the deployed Worker. This does not establish the app's remote secret value."
    );
  await check(
    "Live HTML project references",
    () =>
      retried("Live HTML project references", (onRetry) =>
        waitForLiveHomepage(process.env, new URL(connection.url).hostname, { onRetry })
      ),
    "Live HTML could not be verified against the approved Supabase project. Check authenticated monitor diagnostics and browser build settings."
  );
  const report = {
    checkedAt: new Date().toISOString(),
    project: connection.expectedProjectRef,
    status: results.some((r) => r.status === "FAIL")
      ? "FAIL"
      : results.some((r) => r.status === "UNAVAILABLE")
        ? "INCOMPLETE"
        : "PASS",
    limitations: [
      "Cloudflare never returns secret values; binding presence does not attest remote secret equality.",
      "Authenticated authorization, cleanup adapter compatibility, provider delivery and recovery acceptance require separate verification.",
      "HTML project references do not attest every lazy-loaded browser bundle.",
    ],
    results,
  };
  await mkdir("tmp/backend-alignment", { recursive: true });
  await writeFile("tmp/backend-alignment/latest.json", JSON.stringify(report, null, 2) + "\n");
  for (const result of results) console.log(`${result.status}: ${result.check}: ${result.detail}`);
  console.log(
    `Backend alignment: ${report.status}. Redacted report: tmp/backend-alignment/latest.json`
  );
  if (report.status !== "PASS") process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Backend alignment could not complete; check approved local configuration and read access. Credentials withheld."
  );
  process.exitCode = 2;
});

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
import { checkDeploymentHealth, readinessUrl } from "./lib/deployment-health";
import { verifyRoleOpenapi } from "./lib/foundation-api-openapi.mjs";

loadEnvConfig(process.cwd());

// Read-only live observations. No sign-in, messages, writes, cron triggers,
// deployments, SQL mutations, or customer rows. Reports contain no key values.
type Result = { check: string; status: "PASS" | "FAIL" | "UNAVAILABLE"; detail: string };
const results: Result[] = [];
async function check(name: string, run: () => Promise<void>, failure: string) {
  try {
    await run();
    results.push({ check: name, status: "PASS", detail: "Verified" });
  } catch {
    results.push({ check: name, status: "FAIL", detail: failure });
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Unsupported backend alignment argument");
  const connection = verifyFoundationDeploymentConnection(process.env);
  const expected = {
    NEXT_PUBLIC_DATA_BACKEND: "foundation",
    NEXT_PUBLIC_SUPABASE_URL: connection.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: connection.publishableKey,
    FOUNDATION_SUPABASE_URL: connection.url,
    FOUNDATION_PROJECT_REF: connection.expectedProjectRef,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: connection.publishableKey,
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_REGISTRATION_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_RECOVERY_ENABLED: "true",
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
            const invalid = inspectPublicBindings(
              bindings,
              mainApp
                ? expected
                : { DATA_BACKEND: "foundation", APP_URL: "https://verifymzansi.com" }
            );
            const secretNames = mainApp
              ? [
                  "FOUNDATION_SUPABASE_SECRET_KEY",
                  "SUPABASE_SERVICE_ROLE_KEY",
                  "FOUNDATION_PHONE_OTP_KEY",
                  "INTERNAL_JOBS_SECRET",
                ]
              : ["WORKER_API_KEY"];
            const secrets = inspectSecretBindings(bindings, secretNames, []);
            const problems = [...invalid, ...secrets.missing, ...secrets.unsafe];
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
      verifyRoleOpenapi(serviceOpenapi, manifest, "service_role");
    },
    "Public API read, service credential, function contract or hidden-schema check failed. Review Supabase exposure and key pairing."
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
    async () => {
      await checkDeploymentHealth(readinessUrl("https://verifymzansi.com"));
    },
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
      async () => {
        const key = process.env.RATE_LIMITER_API_KEY;
        if (!key) throw new Error();
        // The Worker implements readOnly without incrementing any counters.
        // Pin the destination before sending the credential.
        const response = await fetch(
          "https://verifymzansi-rate-limiter.verifymzansi.workers.dev/",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              key: "health:probe",
              action: "businesses:read",
              readOnly: true,
            }),
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!response.ok || (await response.json())?.ok !== true) throw new Error();
      },
      "The local RATE_LIMITER_API_KEY is missing, rejected or could not be verified against the deployed Worker. This does not establish the app's remote secret value."
    );
  await check(
    "Live HTML project references",
    async () => {
      const response = await fetch("https://verifymzansi.com", {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
        throw new Error();
      const html = await response.text();
      const hosts = [...new Set(html.match(/[a-z]{20}\.supabase\.co/g) ?? [])];
      if (hosts.length !== 1 || hosts[0] !== new URL(connection.url).hostname) throw new Error();
    },
    "The served HTML does not identify only the approved Supabase project; rebuild and deploy the correct browser configuration."
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

import { loadEnvConfig } from "@next/env";
import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
  type LaunchValidationMode,
} from "../src/lib/config/launch-validation";
import { _resetEnvCacheForTesting, validateEnv } from "../src/lib/config/env";
import { testFixtureSecretFindings } from "./lib/test-fixture-secrets.mjs";

loadEnvConfig(process.cwd());

function parseModeArg(argv: string[]): LaunchValidationMode | undefined {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  if (!modeArg) return undefined;

  const rawValue = modeArg.slice("--mode=".length);
  if (rawValue === "development" || rawValue === "e2e" || rawValue === "production") {
    return rawValue;
  }

  throw new Error(`Unsupported validation mode: ${rawValue}`);
}

const RUNTIME_SECRETS_FLAG = "--runtime-secrets-in-cloudflare";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !arg.startsWith("--mode=") && arg !== RUNTIME_SECRETS_FLAG);
  if (unknown.length > 0) throw new Error(`Unsupported argument: ${unknown.join(" ")}`);
  const mode = parseModeArg(args) ?? resolveLaunchValidationMode(process.env);
  // Release deploys keep runtime-only keys (CLOUDFLARE_RUNTIME_ONLY_SECRETS) out
  // of GitHub; the deploy checks that the Worker holds them by name.
  const runtimeSecretsInCloudflare = args.includes(RUNTIME_SECRETS_FLAG);
  if (runtimeSecretsInCloudflare && mode !== "production")
    throw new Error(`${RUNTIME_SECRETS_FLAG} applies only to --mode=production`);
  process.env.VERIFYMZANSI_RUNTIME_MODE = mode;
  process.env.VERIFYMZANSI_VALIDATION_MODE = mode;

  const summary = validateLaunchConfiguration(process.env, { mode, runtimeSecretsInCloudflare });

  console.log("");
  console.log(`VerifyMzansi launch env validation (${mode})`);
  console.log("");

  for (const check of summary.checks) {
    const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }

  let schemaError: string | null = null;
  try {
    _resetEnvCacheForTesting();
    validateEnv({ mode, strict: true, runtimeSecretsInCloudflare });
  } catch (error) {
    schemaError = error instanceof Error ? error.message : "Unknown env validation error";
  }

  // Test-only secrets (browser test suites, the foundation test copy) are
  // public by design and must never be production settings.
  const testSecrets = mode === "production" ? testFixtureSecretFindings(process.env) : [];
  if (testSecrets.length > 0)
    console.log(
      `  ✗ Test-only secrets: ${testSecrets.join(", ")} use a value from the test suites`
    );

  console.log("");
  if (!summary.isValid || schemaError || testSecrets.length > 0) {
    if (schemaError) {
      console.error(schemaError);
    }
    process.exit(1);
  }

  console.log("Launch env validation passed.");
}

main().catch((error) => {
  console.error("Launch env validation crashed:", error);
  process.exit(1);
});

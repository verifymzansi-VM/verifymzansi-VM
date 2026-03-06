/* eslint-disable no-console */

import { loadEnvConfig } from "@next/env";
import {
  resolveLaunchValidationMode,
  validateLaunchConfiguration,
  type LaunchValidationMode,
} from "../src/lib/config/launch-validation";
import { _resetEnvCacheForTesting, validateEnv } from "../src/lib/config/env";

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

async function main(): Promise<void> {
  const mode = parseModeArg(process.argv.slice(2)) ?? resolveLaunchValidationMode(process.env);
  process.env.VERIFYMZANSI_RUNTIME_MODE = mode;
  process.env.VERIFYMZANSI_VALIDATION_MODE = mode;

  const summary = validateLaunchConfiguration(process.env, { mode });

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
    validateEnv({ mode, strict: true });
  } catch (error) {
    schemaError = error instanceof Error ? error.message : "Unknown env validation error";
  }

  console.log("");
  if (!summary.isValid || schemaError) {
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

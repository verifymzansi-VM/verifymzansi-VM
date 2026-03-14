const { spawn, spawnSync } = require("node:child_process");

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || 3100);
const PLAYWRIGHT_HOST = process.env.PLAYWRIGHT_HOST || "127.0.0.1";

function createDeterministicEnv() {
  const deterministicValues = {
    PORT: String(PLAYWRIGHT_PORT),
    PLAYWRIGHT_TEST_MODE: "1",
    PLAYWRIGHT_SUPABASE_MODE: "stub",
    PLAYWRIGHT_E2E_AUTO_APPROVE: "1",
    PLAYWRIGHT_E2E_AUTH: "1",
    VERIFYMZANSI_RUNTIME_MODE: "e2e",
    VERIFYMZANSI_VALIDATION_MODE: "e2e",
    NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE: "1",
    NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE: "stub",
    NEXT_PUBLIC_SUPABASE_URL: "https://playwright.supabase.stub",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.playwright-anon-key",
    SUPABASE_SERVICE_ROLE_KEY:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.playwright-service-role", // secret-scan: allow deterministic fixture
    R2_ACCOUNT_ID: "playwright-r2-account",
    R2_ACCESS_KEY_ID: "playwright-r2-access-key",
    R2_SECRET_ACCESS_KEY: "playwright-r2-secret-key",
    R2_PUBLIC_BUCKET: "verifymzansi-public",
    R2_PRIVATE_BUCKET: "verifymzansi-private",
    KYC_ENCRYPTION_KEY: "a".repeat(64),
    ID_ENCRYPTION_KEY: "b".repeat(64),
    HMAC_SECRET: "c".repeat(64),
    IP_HASH_SECRET: "playwright-ip-hash-secret-32-chars",
    AFRICASTALKING_API_KEY: "playwright-africas-talking-key",
    AFRICASTALKING_USERNAME: "sandbox",
    AFRICASTALKING_SENDER_ID: "VERIFYMZANS",
    RESEND_API_KEY: "re_playwright_1234567890",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "dummy_site_key",
    TURNSTILE_SECRET_KEY: "dummy_secret_key", // secret-scan: allow deterministic fixture
    NEXT_PUBLIC_APP_URL: `http://${PLAYWRIGHT_HOST}:${PLAYWRIGHT_PORT}`,
    NEXT_PUBLIC_MEDIA_URL: `http://${PLAYWRIGHT_HOST}:${PLAYWRIGHT_PORT}/e2e-media`,
  };

  return {
    ...process.env,
    ...deterministicValues,
  };
}

function spawnPnpmSync(args, env) {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/c", "pnpm", ...args], {
      env,
      stdio: "inherit",
    });
  }

  return spawnSync("pnpm", args, {
    env,
    stdio: "inherit",
  });
}

function spawnPnpm(args, env) {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", ["/c", "pnpm", ...args], {
      env,
      stdio: "inherit",
    });
  }

  return spawn("pnpm", args, {
    env,
    stdio: "inherit",
  });
}

function runBuild(env) {
  const result = spawnPnpmSync(["build"], env);

  if (result.error) {
    console.error("Failed to start Playwright build:", result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const env = createDeterministicEnv();
  runBuild(env);

  const server = spawnPnpm(["start"], env);

  server.on("error", (error) => {
    console.error("Failed to start Playwright web server:", error.message);
    process.exit(1);
  });

  const forwardSignal = (signal) => {
    if (!server.killed) {
      server.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  server.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main();

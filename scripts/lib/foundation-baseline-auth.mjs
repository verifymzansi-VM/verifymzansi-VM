import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertFixturePath } from "./foundation-native-paths.mjs";
import { removeOwnedBaselineContainer } from "./foundation-baseline-container.mjs";

export function baselineAuthDatabaseUri(raw, database) {
  assert.equal(database, "foundation_baseline_replay");
  const uri = new URL(raw);
  assert.ok(["postgres:", "postgresql:"].includes(uri.protocol));
  assert.equal(uri.username, "supabase_auth_admin");
  assert.equal(uri.hostname, "supabase_db_backend-foundation-impl");
  assert.equal(uri.port || "5432", "5432");
  assert.equal(uri.pathname, "/postgres");
  assert.equal(uri.search, "");
  assert.equal(uri.hash, "");
  uri.pathname = `/${database}`;
  return uri;
}

/** Real local GoTrue against the fresh clean SQL database. Auth system migration
 * metadata is copied from the same owned CLI image; no accounts or sessions are.
 * Admin confirmation is a labelled fixture, never a test email/provider claim.
 * Every process is isolated by exact image/container/label/database identities.
 */
export async function proveBaselineAuth({ env, dockerArgs, database, sql, secret, jwt }) {
  assert.equal(database, "foundation_baseline_replay");
  const name = "vm-foundation-baseline-auth",
    label = "vm.foundation.auth-proof",
    nonce = randomUUID(),
    network = "supabase_network_backend-foundation-impl";
  let ownedId,
    createAttempted = false,
    stage = "Auth identity preflight",
    outcome;
  const redactions = [secret];
  const docker = (args, input) =>
    execFileSync("docker", [...dockerArgs, ...args], {
      env,
      input,
      encoding: "utf8",
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    }).trim();
  const inspect = (id) => JSON.parse(docker(["inspect", id]))[0];
  try {
    assert.equal(docker(["ps", "-aq", "--filter", `name=^/${name}$`]), "");
    const auth = inspect("supabase_auth_backend-foundation-impl");
    assert.equal(auth.Config.Labels["com.supabase.cli.project"], "backend-foundation-impl");
    assert.ok(Object.hasOwn(auth.NetworkSettings.Networks, network));
    assert.match(auth.Image, /^sha256:[a-f0-9]{64}$/);
    const vars = Object.fromEntries(
      auth.Config.Env.map((item) => {
        const split = item.indexOf("=");
        return [item.slice(0, split), item.slice(split + 1)];
      })
    );
    const uri = baselineAuthDatabaseUri(vars.GOTRUE_DB_DATABASE_URL, database);
    if (uri.password) redactions.push(decodeURIComponent(uri.password));
    assert.equal(sql("select count(*) from auth.users;", database), "0");
    assert.equal(sql("select count(*) from auth.sessions;", database), "0");
    stage = "local Auth component metadata only";
    assert.equal(
      sql("select count(*) from auth.schema_migrations;", database),
      sql("select count(*) from auth.schema_migrations;")
    );
    // The schema-only replay preserves the CLI Auth component's actual owners.
    // Do not broaden grants to compensate for a broken ownership restore.
    assert.equal(
      sql("select pg_get_userbyid(nspowner) from pg_namespace where nspname='auth';", database),
      sql("select pg_get_userbyid(nspowner) from pg_namespace where nspname='auth';")
    );
    assert.match(vars.GOTRUE_DB_MIGRATIONS_PATH, /^\/[A-Za-z0-9_./-]+$/);
    const config = {
      GOTRUE_API_HOST: "0.0.0.0",
      GOTRUE_API_PORT: "9999",
      GOTRUE_DB_DRIVER: "postgres",
      GOTRUE_DB_DATABASE_URL: uri.toString(),
      GOTRUE_DB_MIGRATIONS_PATH: vars.GOTRUE_DB_MIGRATIONS_PATH,
      GOTRUE_DB_MAX_POOL_SIZE: "3",
      GOTRUE_JWT_SECRET: secret,
      GOTRUE_JWT_EXP: "3600",
      GOTRUE_JWT_AUD: "authenticated",
      GOTRUE_JWT_ADMIN_ROLES: "service_role",
      GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
      GOTRUE_JWT_ISSUER: "http://127.0.0.1:55443/auth/v1",
      GOTRUE_JWT_VALID_METHODS: "HS256",
      API_EXTERNAL_URL: "http://127.0.0.1:55443",
      GOTRUE_SITE_URL: "http://127.0.0.1:55443",
      GOTRUE_DISABLE_SIGNUP: "true",
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
      GOTRUE_EXTERNAL_PHONE_ENABLED: "false",
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: "false",
      GOTRUE_MAILER_AUTOCONFIRM: "false",
      GOTRUE_SMTP_HOST: "127.0.0.1",
      GOTRUE_SMTP_PORT: "1",
      GOTRUE_SMTP_ADMIN_EMAIL: "no-reply@example.invalid",
      GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true",
      GOTRUE_PASSWORD_MIN_LENGTH: "12",
      GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION: "true",
      GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD: "true",
      GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true",
      GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true",
      GOTRUE_LOG_LEVEL: "error",
    };
    stage = "create owned Auth process";
    createAttempted = true;
    ownedId = docker([
      "create",
      "--pull",
      "never",
      "--name",
      name,
      "--label",
      `${label}=${nonce}`,
      "--network",
      network,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--pids-limit",
      "64",
      "--memory",
      "128m",
      "--publish",
      "127.0.0.1:55444:9999",
      ...Object.entries(config).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
      auth.Image,
    ]);
    assert.match(ownedId, /^[a-f0-9]{64}$/);
    assert.equal(inspect(ownedId).Config.Labels[label], nonce);
    docker(["start", ownedId]);
    const running = inspect(ownedId);
    assert.equal(running.State.Running, true);
    assert.deepEqual(running.NetworkSettings.Ports["9999/tcp"], [
      { HostIp: "127.0.0.1", HostPort: "55444" },
    ]);
    stage = "Auth readiness";
    let healthy = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:55444/health", {
          redirect: "error",
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* bounded startup only */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(healthy, true);
    stage = "real fresh Auth and request adapter";
    const files = [
      "scripts/prove-foundation-clean-auth.ts",
      "scripts/lib/foundation-native-totp.mjs",
      "src/lib/foundation/request-api.ts",
      "src/lib/foundation/request-route.ts",
      "src/lib/foundation/authenticated-api.ts",
      "src/lib/foundation/connection.ts",
      "src/lib/foundation/posting-terms.ts",
      "src/lib/supabase/fetch-with-timeout.ts",
      "scripts/lib/foundation-posting-terms-catalogue.mjs",
      "src/lib/legal/terms-documents/catalogue.json",
      "src/lib/legal/terms-documents/posting-v1.json",
      "database/foundation/api.types.ts",
      "database/foundation/api-role-types.ts",
    ];
    for (const file of files) assertFixturePath(process.cwd(), file, { type: "file" });
    const proof = JSON.parse(
      execFileSync(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "scripts/prove-foundation-clean-auth.ts"],
        {
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 60_000,
          input: JSON.stringify({ adminToken: jwt("service_role") }),
          stdio: ["pipe", "pipe", "pipe"],
        }
      )
    );
    assert.ok(proof.status.startsWith("PASS"));
    assert.equal(sql("select count(*) from auth.users;", database), "0");
    assert.equal(sql("select count(*) from auth.sessions;", database), "0");
    assert.equal(sql("select count(*) from private.posting_terms_acceptances;", database), "0");
    assert.equal(sql("select count(*) from private.staff_roles;", database), "0");
    proof.provenance = Object.fromEntries(
      files.map((file) => [
        file,
        createHash("sha256").update(readFileSync(file)).digest("base64url"),
      ])
    );
    outcome = {
      status: "PASS fresh local GoTrue against clean foundation SQL",
      proof,
      authSystemMetadataOnly:
        "PASS copied same-image migration ledger; no original accounts or sessions",
      syntheticAccountCleanup: "PASS zero Auth users, sessions, acceptance facts and staff roles",
      scope:
        "Owned local HS256 Auth and path translation only; hosted ES256 keys, gateway, signup/confirmation delivery and callback acceptance remain separate",
    };
  } catch (error) {
    outcome = { status: "FAIL", stage };
    try {
      const failed = JSON.parse(String(error.stdout ?? ""));
      if (failed.status === "FAIL" && typeof failed.stage === "string")
        outcome.probeStage = failed.stage;
      if (
        failed.status === "FAIL" &&
        failed.assertion &&
        [failed.assertion.actual, failed.assertion.expected].every(
          (value) =>
            value === null ||
            typeof value === "number" ||
            (typeof value === "string" && /^[a-z_]{1,64}$/.test(value))
        )
      )
        outcome.probeAssertion = failed.assertion;
    } catch {
      /* Child output is never copied verbatim. */
    }
    // Never emit container config, database URI, JWTs, passwords or raw logs.
    if (ownedId) {
      try {
        const state = inspect(ownedId).State;
        outcome.containerState = {
          running: state.Running,
          exitCode: state.ExitCode,
          oomKilled: state.OOMKilled,
        };
        const captured = spawnSync("docker", [...dockerArgs, "logs", "--tail", "20", ownedId], {
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 5000,
        });
        const logs = String(captured.stdout ?? "") + String(captured.stderr ?? "");
        outcome.startupDiagnostics = logs
          .split(/\r?\n/)
          .flatMap((line) => {
            try {
              const record = JSON.parse(line);
              if (!["fatal", "error"].includes(record.level)) return [];
              let message = [record.msg, record.error]
                .filter((value) => typeof value === "string")
                .join("; ")
                .replace(/postgres(?:ql)?:\/\/\S+/gi, "[database]");
              for (const value of redactions) message = message.replaceAll(value, "[redacted]");
              return [message.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 500)];
            } catch {
              return [];
            }
          })
          .slice(0, 3);
        outcome.diagnosticCodes = [
          [/must be owner/i, "auth-object-ownership"],
          [/permission denied/i, "auth-database-permission"],
          [/migration/i, "auth-migration-startup"],
          [/connection refused|failed to connect|connect:.*refused/i, "auth-database-connection"],
          [/read.only file system/i, "auth-read-only-filesystem"],
          [/no such file|does not exist/i, "auth-missing-object-or-path"],
          [/required|configuration|config error/i, "auth-configuration"],
        ]
          .filter(([pattern]) => pattern.test(logs))
          .map(([, code]) => code);
      } catch {
        /* retain bounded metadata only */
      }
    }
  } finally {
    try {
      const removed = removeOwnedBaselineContainer({
        docker,
        inspect,
        name,
        label,
        nonce,
        ownedId,
        createAttempted,
      });
      outcome.authContainerCleanup = removed ? "PASS owned container removed" : "NOT_CREATED";
    } catch {
      outcome.status = "INCOMPLETE";
      outcome.authContainerCleanup = "INCOMPLETE preserve vm-foundation-baseline-auth";
    }
  }
  return outcome;
}

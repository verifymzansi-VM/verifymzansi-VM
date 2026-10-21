import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { captureRoleOpenapi } from "./foundation-api-openapi.mjs";
import { assertFixturePath } from "./foundation-native-paths.mjs";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { proveBaselineAuth } from "./foundation-baseline-auth.mjs";
import { removeOwnedBaselineContainer } from "./foundation-baseline-container.mjs";

export function baselineDatabaseUri(raw, database) {
  assert.equal(database, "foundation_baseline_replay");
  const uri = new URL(raw);
  assert.ok(["postgres:", "postgresql:"].includes(uri.protocol));
  assert.equal(uri.username, "authenticator");
  assert.equal(uri.port || "5432", "5432");
  assert.equal(uri.search, "");
  assert.equal(uri.hash, "");
  assert.equal(uri.hostname, "supabase_db_backend-foundation-impl");
  assert.equal(uri.pathname, "/postgres");
  uri.pathname = `/${database}`;
  return uri;
}

// One disposable PostgREST process against the caller's freshly owned SQL-only
// database. Synthetic JWT roles test transport/ACLs, not new GoTrue deployment.
export async function proveBaselineHttp({
  env,
  dockerArgs,
  database,
  expectedCatalogue,
  candidateHash,
  sql,
}) {
  assert.equal(database, "foundation_baseline_replay");
  const name = "vm-foundation-baseline-http";
  const label = "vm.foundation.http-proof";
  const nonce = randomUUID();
  const port = "55443";
  const network = "supabase_network_backend-foundation-impl";
  let ownedId,
    createAttempted = false,
    stage = "HTTP identity preflight",
    outcome,
    authProof;
  const docker = (args) =>
    execFileSync("docker", [...dockerArgs, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  const inspect = (id) => JSON.parse(docker(["inspect", id]))[0];
  try {
    assert.equal(
      docker(["ps", "-aq", "--filter", `name=^/${name}$`]),
      "",
      "Existing HTTP proof must not be reused or deleted"
    );
    const rest = inspect("supabase_rest_backend-foundation-impl");
    const db = inspect("supabase_db_backend-foundation-impl");
    for (const container of [rest, db]) {
      assert.equal(container.Config.Labels["com.supabase.cli.project"], "backend-foundation-impl");
      assert.ok(Object.hasOwn(container.NetworkSettings.Networks, network));
    }
    assert.match(rest.Image, /^sha256:[a-f0-9]{64}$/);
    const vars = Object.fromEntries(
      rest.Config.Env.map((item) => {
        const split = item.indexOf("=");
        return [item.slice(0, split), item.slice(split + 1)];
      })
    );
    const uri = baselineDatabaseUri(vars.PGRST_DB_URI, database);
    const secret = randomBytes(48).toString("base64url");
    const jwt = (role) => {
      const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(
        JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 120 })
      ).toString("base64url");
      const data = `${head}.${body}`;
      return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
    };
    stage = "create owned HTTP proof";
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
      `127.0.0.1:${port}:3000`,
      "--env",
      `PGRST_DB_URI=${uri.toString()}`,
      "--env",
      "PGRST_DB_SCHEMAS=api",
      "--env",
      "PGRST_DB_ANON_ROLE=anon",
      "--env",
      `PGRST_JWT_SECRET=${secret}`,
      "--env",
      "PGRST_SERVER_PORT=3000",
      "--env",
      "PGRST_LOG_LEVEL=error",
      rest.Image,
    ]);
    assert.match(ownedId, /^[a-f0-9]{64}$/);
    assert.equal(inspect(ownedId).Config.Labels[label], nonce);
    stage = "start owned HTTP proof";
    docker(["start", ownedId]);
    stage = "verify running HTTP identity and loopback binding";
    const running = inspect(ownedId);
    assert.equal(running.State.Running, true);
    assert.deepEqual(running.NetworkSettings.Ports["3000/tcp"], [
      { HostIp: "127.0.0.1", HostPort: port },
    ]);
    const request = async (path, role, body = {}, profile = "api") => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Profile": profile,
          "Accept-Profile": profile,
          ...(role ? { Authorization: `Bearer ${jwt(role)}` } : {}),
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      return { status: response.status, data: await response.json() };
    };
    stage = "owned HTTP schema readiness";
    let catalogue;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const response = await request("/rpc/billing_catalogue");
        if (response.status === 200) {
          catalogue = response.data;
          break;
        }
      } catch {
        /* bounded startup only */
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    assert.deepEqual(catalogue, expectedCatalogue);
    stage = "role-sensitive OpenAPI surfaces";
    const openapiProof = await captureRoleOpenapi({ port, jwt, candidateHash });
    stage = "actual SDK public adapter and strict DTO";
    const adapterFiles = [
      "scripts/prove-foundation-public-adapter.ts",
      "src/lib/foundation/public-api.ts",
      "src/lib/foundation/connection.ts",
      "src/lib/foundation/billing-catalogue.ts",
      "src/lib/foundation/post-search.ts",
      "src/lib/foundation/public-post-contract.ts",
      "src/lib/foundation/public-post.ts",
      "src/lib/foundation/event-window-dto.ts",
      "src/lib/foundation/reference-catalogue.ts",
      "src/lib/foundation/posting-terms.ts",
      "scripts/lib/foundation-posting-terms-catalogue.mjs",
      "src/lib/legal/terms-documents/catalogue.json",
      "src/lib/legal/terms-documents/posting-v1.json",
      "src/lib/supabase/fetch-with-timeout.ts",
      "database/foundation/api.types.ts",
      "database/foundation/api-role-types.ts",
    ];
    for (const file of adapterFiles) assertFixturePath(process.cwd(), file, { type: "file" });
    const adapterProof = JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/prove-foundation-public-adapter.ts"],
        {
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
          input: JSON.stringify({ token: jwt("anon"), expectedCatalogue: catalogue }),
          stdio: ["pipe", "pipe", "pipe"],
        }
      )
    );
    assert.ok(adapterProof.status.startsWith("PASS"));
    adapterProof.provenance = Object.fromEntries(
      adapterFiles.map((file) => [
        file,
        createHash("sha256").update(readFileSync(file)).digest("base64url"),
      ])
    );
    stage = "HTTP forbidden raw APIs and private schema";
    const checks = [];
    for (const role of [null, "authenticated", "service_role"]) {
      for (const [api, body] of [
        ["grant_intro_trial", { p_owner: nonce, p_identity_hmac: "A".repeat(43), p_days: 7 }],
        [
          "record_identity_ban",
          { p_decision_id: nonce, p_identity_hmac: "A".repeat(43), p_category: "fraud" },
        ],
      ]) {
        const result = await request(`/rpc/${api}`, role, body);
        assert.equal(result.status, 404);
        assert.equal(result.data.code, "PGRST202");
        checks.push({ role: role ?? "anon", api, status: result.status, code: result.data.code });
      }
      const privateRead = await request("/rpc/grant_intro_trial", role, {}, "internal");
      assert.equal(privateRead.status, 406);
      assert.equal(privateRead.data.code, "PGRST106");
    }
    const trusted = await request("/rpc/grant_verified_intro_trial", "service_role", {
      p_owner: nonce,
      p_days: 7,
    });
    assert.equal(trusted.status, 403);
    assert.equal(trusted.data.code, "42501");
    stage = "real fresh Auth against clean SQL";
    authProof = await proveBaselineAuth({ env, dockerArgs, database, sql, secret, jwt });
    assert.ok(authProof.status.startsWith("PASS"));
    outcome = {
      status: "PASS clean-baseline HTTP catalogue/role/schema surface",
      checks,
      adapterProof,
      openapiProof,
      authProof,
      privateSchemaDenied: true,
      trustedDerivedApiRecognised: true,
      catalogueIdsAndTerms: "PASS",
      authenticationScope:
        "Synthetic role JWT surfaces plus genuine fresh local GoTrue sessions; hosted ES256/gateway/provider/callback acceptance remains INCOMPLETE",
    };
  } catch (error) {
    outcome = { status: "FAIL", stage, ...(authProof ? { authProof } : {}) }; // Never emit DB URI, JWTs or container environment.
    const symptoms = String(error.stderr ?? "");
    const classify = (text) =>
      [
        [/failed to create.*thread|Resource temporarily unavailable/i, "local-thread-limit"],
        [/read.only file system/i, "read-only-filesystem"],
        [/permission denied/i, "local-permission"],
        [/port.*(?:allocated|in use)/i, "local-port-in-use"],
        [/out of memory|cannot allocate memory/i, "local-memory-limit"],
        [/executable file not found/i, "container-entrypoint"],
      ]
        .filter(([pattern]) => pattern.test(text))
        .map(([, code]) => code);
    outcome.diagnosticCodes = classify(symptoms);
    if (ownedId) {
      try {
        const state = inspect(ownedId).State;
        outcome.containerState = {
          running: state.Running,
          exitCode: state.ExitCode,
          oomKilled: state.OOMKilled,
        };
        outcome.diagnosticCodes.push(...classify(docker(["logs", "--tail", "20", ownedId])));
      } catch {
        /* Never expose diagnostic text/configuration. */
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
      outcome.httpContainerCleanup = removed ? "PASS owned container removed" : "NOT_CREATED";
    } catch {
      outcome.httpContainerCleanup = "INCOMPLETE preserve vm-foundation-baseline-http";
      outcome.status = "INCOMPLETE";
    }
  }
  return outcome;
}

// Identity and safety guards for the foundation browser test copy (M0.7).
// Pure functions only (unit-tested in scripts/foundation-e2e-target.test.mjs):
// the test copy may only ever talk to a throwaway stack on this machine.
import { createHash } from "node:crypto";
import path from "node:path";

/** The throwaway stack. Ports must match e2e/foundation/fixture/supabase-config.toml. */
export const E2E_FIXTURE = Object.freeze({
  projectId: "vm-foundation-e2e",
  workdir: "tmp/foundation-e2e",
  configTemplate: "e2e/foundation/fixture/supabase-config.toml",
  stateFile: "tmp/foundation-e2e/state.json",
  apiPort: 55443,
  dbPort: 55452,
  mailPort: 55454,
  /** The local rate limiter stub that `serve` runs (scripts/lib/foundation-e2e-limiter.mjs). */
  limiterPort: 55456,
  /** The local email relay that `serve` runs (scripts/lib/foundation-e2e-mail-relay.mjs). */
  mailRelayPort: 55451,
  /** Mock payment page (HTTPS, served by the browser tests themselves; nothing listens). */
  mockPaymentPort: 55455,
  /** Stand-in for the payment provider's lookup API, run by the checkout
   * browser tests themselves (M0.9c); nothing listens there otherwise. Outside
   * 55450-55459, which the stack's config fills. */
  providerPort: 55448,
  appPort: 3110,
  /** The website's connection guard accepts only this marker for a local stack. */
  projectRef: "local-foundation",
  /** Services the copy does not need; Auth, PostgREST, Kong, Mailpit and Postgres stay. */
  excludedServices:
    "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
});
export const E2E_DB_CONTAINER = `supabase_db_${E2E_FIXTURE.projectId}`;
/** Synthetic secret for the website's email job route (/api/webhooks/ops-jobs);
 * it exists only in the copy, where the browser tests run the job. */
export const LOCAL_OPS_JOBS_SECRET = "local-fixture-ops-jobs-secret-0123456789";
/** A synthetic key for the copy, derived from a public, non-secret label:
 * 64 hex characters (the shape the website requires). Anyone can recompute
 * it, which is the point: it protects nothing outside this machine. */
function localFixtureKey(label) {
  return createHash("sha256").update(`vm-foundation-e2e ${label}`).digest("hex");
}
/** Synthetic keys for the website's phone-code and ID-number protection in
 * the copy only (the website refuses keys with fewer than 8 distinct digits). */
export const LOCAL_PHONE_OTP_KEY = localFixtureKey("phone-otp");
export const LOCAL_ID_ENCRYPTION_KEY = localFixtureKey("id-encryption");
/** Synthetic secret for the website's payment status-check job route
 * (/api/internal/payments/reconcile), which the checkout browser tests call as
 * the every-10-minutes Worker does. Exists only in the copy. */
export const LOCAL_INTERNAL_JOBS_SECRET = localFixtureKey("internal-jobs");
/** Synthetic payment-notification signing secret, in the provider's
 * whsec_<base64> form: the copy's website verifies notifications with it and
 * the checkout browser tests sign their mock notifications with it. */
export const LOCAL_OZOW_WEBHOOK_SECRET = `whsec_${createHash("sha256")
  .update("vm-foundation-e2e ozow-webhook")
  .digest("base64")}`;
/** Synthetic payment-provider site code; exists only in the copy. */
export const LOCAL_OZOW_SITE_CODE = "local-fixture-ozow-site";
/** Files the website writes in the copy (git-ignored, reset on `up`): the SMS
 * it would have sent, and every request it tried to send off this machine. */
export const TEST_SMS_SINK_FILE = "tmp/foundation-e2e/sms-sink.jsonl";
export const OUTBOUND_LOG_FILE = "tmp/foundation-e2e/outbound.jsonl";

/** Hosted projects this copy must never reach (production, the retired source
 * project and the other known hosted refs from src/lib/foundation/connection.ts). */
export const HOSTED_PROJECT_REFS = Object.freeze([
  "gntzjtuncsyefujajmjy",
  "tnygdgormnofpgjknlhr",
  "ubrtdtmumfhjpuegxnhj",
  "pfuurrahjdewiphmjyiq",
  "vlsynwsekujghfufvsxn",
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function refuse(what) {
  // Never echo the refused value: it may be a real connection string.
  throw new Error(`Foundation test copy refused: ${what} must point at the local throwaway stack`);
}

/**
 * Accepts only a loopback URL (127.0.0.1, localhost or ::1) with the expected
 * protocol and, when given, the expected port. Refuses hosted Supabase
 * (*.supabase.co / *.supabase.in), every other host, embedded hosted project
 * refs anywhere in the value, query strings, fragments and malformed input.
 * @param {unknown} value
 * @param {{ what: string, protocols: string[], port?: number, allowUserInfo?: boolean }} options
 * @returns {URL}
 */
export function assertLoopbackUrl(value, { what, protocols, port, allowUserInfo = false }) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) refuse(what);
  const lowered = value.toLowerCase();
  if (HOSTED_PROJECT_REFS.some((ref) => lowered.includes(ref))) refuse(what);
  if (/supabase\.(co|in|com|net)\b/.test(lowered)) refuse(what);
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(what);
  }
  if (!protocols.includes(url.protocol)) refuse(what);
  if (!LOOPBACK_HOSTS.has(url.hostname)) refuse(what);
  if (port !== undefined && url.port !== String(port)) refuse(what);
  if (url.search || url.hash) refuse(what);
  if (!allowUserInfo && (url.username || url.password)) refuse(what);
  return url;
}

/**
 * The single gate every entry point (setup, seed, web server, Playwright config)
 * passes before it touches the database or starts the website.
 * - apiUrl: the stack's API gateway, exactly http://127.0.0.1:<apiPort>.
 * - dbUrl: the stack's Postgres, a postgresql:// loopback URL on <dbPort>.
 * - env: the environment handed to the website; every Supabase or foundation
 *   URL in it must be that same local gateway, and the project ref the local
 *   marker.
 * @param {{ apiUrl: string | undefined, dbUrl?: string, env?: Record<string, string | undefined> }} target
 * @returns {string} the API origin
 */
export function assertLocalFoundationTarget({ apiUrl, dbUrl, env = {} }) {
  const api = assertLoopbackUrl(apiUrl, {
    what: "the database API address",
    protocols: ["http:"],
    port: E2E_FIXTURE.apiPort,
  });
  // The website's connection guard only accepts 127.0.0.1 for a local stack.
  if (api.hostname !== "127.0.0.1" || api.pathname !== "/") refuse("the database API address");
  if (dbUrl !== undefined) {
    assertLoopbackUrl(dbUrl, {
      what: "the database address",
      protocols: ["postgresql:", "postgres:"],
      port: E2E_FIXTURE.dbPort,
      allowUserInfo: true,
    });
  }
  // Names in any letter case: Windows treats "Supabase_Url" as SUPABASE_URL.
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue;
    if (/SUPABASE_URL$/i.test(key) && value !== api.origin) refuse(key);
    if (/(DATABASE|POSTGRES|DB)_URL$/i.test(key))
      assertLoopbackUrl(value, {
        what: key,
        protocols: ["postgresql:", "postgres:"],
        port: E2E_FIXTURE.dbPort,
        allowUserInfo: true,
      });
    if (/PROJECT_REF$/i.test(key) && value !== E2E_FIXTURE.projectRef) refuse(key);
    if (/^ENVIRONMENT$/i.test(key) && String(value).toLowerCase() === "production")
      refuse("ENVIRONMENT");
  }
  return api.origin;
}

const WINDOWS_ENGINE = "npipe:////./pipe/dockerDesktopLinuxEngine";
const LINUX_SOCKET = "unix:///var/run/docker.sock";

/**
 * Docker must be this machine's own engine, so 127.0.0.1 ports really are on
 * this machine: Windows Docker Desktop's Linux engine (context desktop-linux),
 * or the standard local socket on Linux/macOS. DOCKER_HOST or DOCKER_CONTEXT
 * pointing anywhere else is refused. Returns the context to pin.
 */
export function localDockerContext({ platform, env, inspect }) {
  const fail = () => {
    throw new Error("Foundation test copy refused: Docker must be this machine's local engine");
  };
  if (platform === "win32") {
    if (env.DOCKER_HOST !== undefined && env.DOCKER_HOST !== WINDOWS_ENGINE) fail();
    if (env.DOCKER_CONTEXT !== undefined && env.DOCKER_CONTEXT !== "desktop-linux") fail();
    if (inspect("desktop-linux") !== WINDOWS_ENGINE) fail();
    return "desktop-linux";
  }
  if (platform !== "linux" && platform !== "darwin") fail();
  if (env.DOCKER_HOST !== undefined && env.DOCKER_HOST !== LINUX_SOCKET) fail();
  if (env.DOCKER_CONTEXT !== undefined && env.DOCKER_CONTEXT !== "default") fail();
  if (inspect("default") !== LINUX_SOCKET) fail();
  return "default";
}

/** Throwaway workspace path, inside the repository's ignored tmp/ folder. */
export function fixtureWorkdir(root = process.cwd()) {
  return path.resolve(root, E2E_FIXTURE.workdir);
}

/**
 * Migration filenames for the workspace copy of the replay, in replay order:
 * candidate.sql takes the version of the guarded CLI migration that stands in
 * for it, the baseline supplement the version just before the update that
 * needs it, and each update keeps its own name. The platform prelude is not
 * copied: the real local stack provides the roles, Auth schema and extensions.
 */
export function replayMigrationNames(steps) {
  const names = [];
  for (const step of steps) {
    if (step.label === "platform-prelude.sql") continue;
    if (step.label === "candidate.sql")
      names.push({ ...step, name: "20261015140403_candidate.sql" });
    else if (step.label === "baseline-supplement.sql") {
      const next = steps[steps.indexOf(step) + 1]?.label ?? "";
      const version = /^(\d{14})_/.exec(next)?.[1];
      if (!version) throw new Error("Baseline supplement must precede an update");
      names.push({
        ...step,
        name: `${String(BigInt(version) - 1n)}_replay_baseline_supplement.sql`,
      });
    } else if (/^\d{14}_[a-z0-9_]+\.sql$/.test(step.label))
      names.push({ ...step, name: step.label });
    else throw new Error(`Unexpected replay step ${step.label}`);
  }
  const sorted = names.map((entry) => entry.name).sort();
  if (new Set(sorted).size !== names.length || sorted.some((name, i) => name !== names[i].name))
    throw new Error("Replay migration names do not sort in replay order");
  return names;
}

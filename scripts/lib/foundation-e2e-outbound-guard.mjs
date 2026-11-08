// Server-side network fence for the foundation test copy's website (M0.9b).
// `serve` preloads it into the copy's `next start` process only (never into a
// build, the stub suite or production), through
// scripts/lib/foundation-e2e-outbound-preload.mjs. It wraps fetch:
// - requests to this machine (loopback) go through unchanged;
// - the password breach check (a k-anonymity range request) is answered here
//   with "not found", so registration works without the internet, except for
//   the copy's one known-breached test password (KNOWN_BREACHED_PASSWORD);
// - every other request is refused before it leaves the machine.
// Each answered or refused request is recorded (origin only, no path, query or
// body) in tmp/foundation-e2e/outbound.jsonl, so browser tests can prove that
// no provider (SMS, email, payments, identity checks) was contacted.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { KNOWN_BREACHED_PASSWORD, OUTBOUND_LOG_FILE } from "./foundation-e2e-target.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const BREACH_CHECK_HOST = "api.pwnedpasswords.com";
const KNOWN_BREACHED_SHA1 = createHash("sha1")
  .update(KNOWN_BREACHED_PASSWORD, "utf8")
  .digest("hex")
  .toUpperCase();

/**
 * @param {string} href
 * @returns {"local" | "breach-check" | "blocked"}
 */
export function classifyOutbound(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return "blocked";
  }
  if (url.username || url.password) return "blocked";
  if ((url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname))
    return "local";
  if (
    url.protocol === "https:" &&
    url.hostname === BREACH_CHECK_HOST &&
    url.port === "" &&
    /^\/range\/[0-9A-F]{5}$/i.test(url.pathname) &&
    !url.search
  )
    return "breach-check";
  return "blocked";
}

/** A padded range reply in which no suffix matches: one padding entry with
 * count 0, the format the breach service itself uses for padding. For the
 * range holding KNOWN_BREACHED_PASSWORD, its suffix is listed as seen often.
 * @param {string} [prefix] the five hex characters of the range request
 */
export function breachCheckReply(prefix = "") {
  const padding = `${"0".repeat(35)}:0\r\n`;
  return prefix.toUpperCase() === KNOWN_BREACHED_SHA1.slice(0, 5)
    ? `${KNOWN_BREACHED_SHA1.slice(5)}:1000\r\n${padding}`
    : padding;
}

function originOf(href) {
  try {
    return new URL(href).origin;
  } catch {
    return "unparseable";
  }
}

/**
 * Replaces globalThis.fetch with the fence. Returns the installed function.
 * @param {{ root?: string, fetchImpl?: typeof fetch }} [options]
 */
export function installOutboundGuard({ root = process.cwd(), fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch to guard");
  const file = path.resolve(root, OUTBOUND_LOG_FILE);
  const record = (origin, outcome) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(
        file,
        `${JSON.stringify({ origin, outcome, at: new Date().toISOString() })}\n`
      );
    } catch {
      // Recording is evidence only; the fence itself never depends on it.
    }
  };
  /** @type {typeof fetch} */
  const guarded = async (input, init) => {
    const href =
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    const kind = classifyOutbound(href);
    if (kind === "local") return fetchImpl(input, init);
    if (kind === "breach-check") {
      record(originOf(href), "answered-locally");
      return new Response(breachCheckReply(new URL(href).pathname.slice("/range/".length)), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    record(originOf(href), "blocked");
    throw new TypeError("fetch failed: the foundation test copy keeps requests on this machine");
  };
  globalThis.fetch = guarded;
  return guarded;
}

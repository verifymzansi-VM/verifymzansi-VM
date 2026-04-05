#!/usr/bin/env node
/* eslint-disable no-console */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const strictMode = args.has("--strict");
const strictAllWarnings = args.has("--strict-all");
const jsonOutput = args.has("--json");
const strictChecksArg = rawArgs.find((arg) => arg.startsWith("--strict-checks="));

const DOMAIN = process.env.CF_POSTURE_DOMAIN || "verifymzansi.com";
const WWW_DOMAIN = `www.${DOMAIN}`;

const strictWarnChecks = new Set(
  (
    (strictChecksArg ? strictChecksArg.slice("--strict-checks=".length) : "") ||
    process.env.CF_POSTURE_STRICT_WARN_CHECKS ||
    "Health endpoint,HSTS"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

async function runCommand(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

function getHeaderValue(headers, name) {
  return headers.get(name) ?? "";
}

function parseTrace(traceText) {
  const map = new Map();
  for (const line of traceText.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return map;
}

async function fetchWithHeaders(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "user-agent": "verifymzansi-cloudflare-posture-check/1.0",
      accept: "*/*",
    },
  });

  return {
    status: response.status,
    headers: response.headers,
    location: response.headers.get("location") ?? "",
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "user-agent": "verifymzansi-cloudflare-posture-check/1.0",
      accept: "text/html,*/*",
    },
  });

  const text = await response.text();
  return { status: response.status, text };
}

async function tryFetchWithHeaders(url) {
  try {
    const result = await fetchWithHeaders(url);
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      location: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function reportResult(severity, message) {
  const prefix = severity === "fail" ? "FAIL" : severity === "warn" ? "WARN" : "PASS";
  console.log(`${prefix}: ${message}`);
}

function summarizeChecks(checks) {
  const failCount = checks.filter((check) => check.severity === "fail").length;
  const warnCount = checks.filter((check) => check.severity === "warn").length;
  const passCount = checks.length - failCount - warnCount;
  return { failCount, warnCount, passCount };
}

function shouldFailFromWarnings(checks) {
  if (strictAllWarnings) {
    return checks.some((check) => check.severity === "warn");
  }

  if (!strictMode) {
    return false;
  }

  return checks.some((check) => check.severity === "warn" && strictWarnChecks.has(check.name));
}

function emitOutput(checks) {
  const summary = summarizeChecks(checks);
  const strictWarningFailure = shouldFailFromWarnings(checks);

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          domain: DOMAIN,
          strictMode,
          strictAllWarnings,
          strictWarnChecks: [...strictWarnChecks],
          checks,
          summary,
          strictWarningFailure,
        },
        null,
        2
      )
    );
  } else {
    console.log(`\nCloudflare posture check for ${DOMAIN}`);
    console.log("----------------------------------------");
    for (const check of checks) {
      reportResult(check.severity, `${check.name}: ${check.detail}`);
    }
    console.log("----------------------------------------");
    console.log(`Summary: ${summary.failCount} fail, ${summary.warnCount} warn, ${summary.passCount} pass`);

    if (strictMode || strictAllWarnings) {
      const strictLabel = strictAllWarnings
        ? "all warnings fail"
        : `selected warnings fail (${[...strictWarnChecks].join(", ")})`;
      console.log(`Strict gate: enabled (${strictLabel})`);
    }
  }

  return summary.failCount > 0 || strictWarningFailure;
}

async function main() {
  const checks = [];

  const root = await tryFetchWithHeaders(`https://${DOMAIN}/`);
  checks.push({
    name: "Root availability",
    severity: root.ok && root.status >= 200 && root.status < 400 ? "pass" : "fail",
    detail: root.ok ? `https://${DOMAIN}/ -> ${root.status}` : root.error,
  });

  if (!root.ok) {
    const shouldFail = emitOutput(checks);
    process.exit(shouldFail ? 1 : 0);
  }

  const hsts = getHeaderValue(root.headers, "strict-transport-security");
  checks.push({
    name: "HSTS",
    severity: hsts.includes("max-age") ? "pass" : "warn",
    detail: hsts || "missing",
  });

  const rootCache = getHeaderValue(root.headers, "cache-control");
  checks.push({
    name: "Root cache-control",
    severity: rootCache.includes("no-store") || rootCache.includes("no-cache") ? "pass" : "warn",
    detail: rootCache || "missing",
  });

  let discoveredStaticPath = "";
  try {
    const rootHtml = await fetchText(`https://${DOMAIN}/`);
    if (rootHtml.status >= 200 && rootHtml.status < 400) {
      const match = rootHtml.text.match(/\/(_next\/static\/[^"]+\.(?:css|js))/i);
      discoveredStaticPath = match ? match[1] : "";
    }
  } catch {
    discoveredStaticPath = "";
  }

  if (!discoveredStaticPath) {
    checks.push({
      name: "Static asset cache-control",
      severity: "warn",
      detail: "unable to discover static asset path from root HTML",
    });
  } else {
    const staticAsset = await tryFetchWithHeaders(`https://${DOMAIN}/${discoveredStaticPath}`);
    const staticCache = getHeaderValue(staticAsset.headers, "cache-control");
    checks.push({
      name: "Static asset cache-control",
      severity: staticAsset.ok
        ? /max-age=31536000|immutable/.test(staticCache)
          ? "pass"
          : "warn"
        : "warn",
      detail: staticAsset.ok
        ? `${staticAsset.status} ${staticCache || "missing"} (${discoveredStaticPath})`
        : `${staticAsset.error} (${discoveredStaticPath})`,
    });
  }

  const health = await tryFetchWithHeaders(`https://${DOMAIN}/api/health`);
  checks.push({
    name: "Health endpoint",
    severity: health.ok
      ? health.status === 200
        ? "pass"
        : health.status === 503
          ? "warn"
          : "fail"
      : "fail",
    detail: health.ok ? `https://${DOMAIN}/api/health -> ${health.status}` : health.error,
  });

  try {
    const traceResponse = await fetch(`https://${DOMAIN}/cdn-cgi/trace`, {
      headers: { "user-agent": "verifymzansi-cloudflare-posture-check/1.0" },
    });
    const traceText = await traceResponse.text();
    const trace = parseTrace(traceText);

    const httpVersion = trace.get("http") || "unknown";
    checks.push({
      name: "HTTP protocol",
      severity: httpVersion === "http/3" ? "pass" : "warn",
      detail: httpVersion,
    });

    const tlsVersion = trace.get("tls") || "unknown";
    checks.push({
      name: "TLS version",
      severity: tlsVersion === "TLSv1.3" ? "pass" : "warn",
      detail: tlsVersion,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    checks.push({
      name: "HTTP protocol",
      severity: "warn",
      detail: `trace unavailable: ${reason}`,
    });
    checks.push({
      name: "TLS version",
      severity: "warn",
      detail: `trace unavailable: ${reason}`,
    });
  }

  const www = await tryFetchWithHeaders(`https://${WWW_DOMAIN}/`);
  checks.push({
    name: "www hostname behavior",
    severity: www.ok && www.status >= 200 && www.status < 400 ? "pass" : "warn",
    detail: www.ok ? `${www.status}${www.location ? ` location=${www.location}` : ""}` : www.error,
  });

  const nslookupNs = await runCommand("nslookup", ["-type=NS", DOMAIN]);
  checks.push({
    name: "NS lookup",
    severity: nslookupNs.ok ? "pass" : "warn",
    detail: nslookupNs.ok ? "resolved" : "command failed",
  });

  const nslookupDs = await runCommand("nslookup", ["-type=DS", DOMAIN]);
  const dsHasRecord = /\bDS\b|\tds\s*=|\sDS\s/i.test(nslookupDs.stdout);
  checks.push({
    name: "DNSSEC DS record",
    severity: dsHasRecord ? "pass" : "warn",
    detail: dsHasRecord ? "DS record found" : "no DS record detected",
  });

  const shouldFail = emitOutput(checks);
  if (shouldFail) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Cloudflare posture check failed:", error);
  process.exit(1);
});

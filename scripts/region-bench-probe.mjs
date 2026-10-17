#!/usr/bin/env node
// BF-01 regional probe. Measures the direct browser-equivalent paths against a
// disposable benchmark project loaded with docs/backend-foundation/prototypes/region-bench.sql.
// Output rows match summarizeRegionSamples() and contain timing metadata only:
// never tokens, keys, passwords or response bodies.
//
// Usage: node scripts/region-bench-probe.mjs <config.json> <out.json>
// config: { region, projectUrl, publishableKey, ownerEmail, ownerPassword, datasetHash,
//           compute, city, connection, carrier, probeId, window, warm?, cold? }
// Keep the config file under the ignored tmp/ directory.
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";

const [configFile, outFile] = process.argv.slice(2);
if (!configFile || !outFile) {
  console.error("Usage: node scripts/region-bench-probe.mjs <config.json> <out.json>");
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(configFile, "utf8"));
const WARM = cfg.warm ?? 100;
const COLD = cfg.cold ?? 20;
// Supabase Auth limits password sign-in to 30 per 5 minutes per IP by default.
const AUTH_SPACING_MS = cfg.authSpacingMs ?? 12_000;
// Spread RPC samples over the same window as the paced auth samples.
const RPC_SPACING_MS = cfg.rpcSpacingMs ?? 1_800;
const base = new URL(cfg.projectUrl);
const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });

function timedRequest({ method, path, headers, body, cold }) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const ms = (t) => (t === null ? null : Number(t - t0) / 1e6);
    let dns = null;
    let connect = null;
    let tls = null;
    let ttfb = null;
    const agent = cold ? new https.Agent({ keepAlive: false }) : warmAgent;
    const req = https.request(
      {
        hostname: base.hostname,
        path,
        method,
        agent,
        headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body) } : {}) },
        timeout: 15_000,
      },
      (res) => {
        let first = true;
        const chunks = [];
        res.on("data", (c) => {
          if (first) {
            ttfb = process.hrtime.bigint();
            first = false;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const end = process.hrtime.bigint();
          const ray = String(res.headers["cf-ray"] ?? "");
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
            edgeColo: ray.includes("-") ? ray.split("-").pop() : "unknown",
            totalMs: ms(end),
            ttfbMs: ms(ttfb ?? end),
            dnsMs: ms(dns),
            connectMs: ms(connect),
            tlsMs: ms(tls),
          });
        });
      }
    );
    req.on("socket", (socket) => {
      // A reused keep-alive socket is already connected; only new sockets have phases.
      if (!socket.connecting) return;
      socket.once("lookup", () => (dns = process.hrtime.bigint()));
      socket.once("connect", () => (connect = process.hrtime.bigint()));
      socket.once("secureConnect", () => (tls = process.hrtime.bigint()));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) =>
      resolve({ status: 0, error: error.message === "timeout" ? "timeout" : "network", body: "" })
    );
    if (body) req.write(body);
    req.end();
  });
}

const apiHeaders = (token) => ({
  apikey: cfg.publishableKey,
  authorization: `Bearer ${token ?? cfg.publishableKey}`,
  "content-type": "application/json",
  accept: "application/json",
});

let session = null;
async function signIn(cold) {
  const r = await timedRequest({
    method: "POST",
    path: "/auth/v1/token?grant_type=password",
    headers: apiHeaders(),
    body: JSON.stringify({ email: cfg.ownerEmail, password: cfg.ownerPassword }),
    cold,
  });
  if (r.status === 200) session = JSON.parse(r.body);
  return { r, dbMs: null };
}
async function refresh(cold) {
  const r = await timedRequest({
    method: "POST",
    path: "/auth/v1/token?grant_type=refresh_token",
    headers: apiHeaders(),
    body: JSON.stringify({ refresh_token: session.refresh_token }),
    cold,
  });
  if (r.status === 200) session = JSON.parse(r.body);
  return { r, dbMs: null };
}
function rpc(fn, args, auth) {
  return async (cold) => {
    const r = await timedRequest({
      method: "POST",
      path: `/rest/v1/rpc/${fn}`,
      headers: apiHeaders(auth ? session.access_token : null),
      body: JSON.stringify(typeof args === "function" ? args() : args),
      cold,
    });
    let dbMs = null;
    if (r.status === 200) {
      try {
        const parsed = JSON.parse(r.body);
        dbMs = Number.isFinite(parsed.ms) ? parsed.ms : null;
        r.rowCount = parsed.n;
      } catch {
        r.status = -1;
      }
    }
    return { r, dbMs };
  };
}

let seq = 0;
const next = () => (seq = (seq * 1103515245 + 12345) % 2147483648);
const SEARCH_TERMS = [
  "braai",
  "solar garden",
  "bakkie tyres",
  "guesthouse",
  "laptop",
  "festival boat",
];
const paths = {
  browse: rpc("bench_browse", () => ({ p_category: next() % 2 ? null : 1 + (next() % 30) }), false),
  detail: rpc("bench_detail", () => ({ p_id: 1 + (next() % 5000) }), false),
  search: rpc("bench_search", () => ({ p_q: SEARCH_TERMS[next() % SEARCH_TERMS.length] }), false),
  owner_dashboard: rpc("bench_owner_posts", {}, true),
  contact_reveal: rpc("bench_reveal_contact", () => ({ p_id: 1 + (next() % 5000) }), true),
  evidence_metadata: rpc("bench_evidence_meta", {}, true),
};

const samples = [];
function record(path, cacheState, { r, dbMs }, expectRows) {
  const ok =
    r.status === 200 && (expectRows === undefined || r.rowCount > 0 || expectRows === "any");
  samples.push({
    region: cfg.region,
    city: cfg.city,
    connection: cfg.connection,
    carrier: cfg.carrier,
    probeId: cfg.probeId,
    edgeColo: r.edgeColo ?? "unknown",
    window: cfg.window,
    path,
    transport: "direct",
    placement: "none",
    cacheState,
    datasetHash: cfg.datasetHash,
    compute: cfg.compute,
    payloadClass: path,
    ok,
    totalMs: ok ? r.totalMs : null,
    ttfbMs: ok ? r.ttfbMs : null,
    queryCount: path === "sign_in" || path === "refresh" ? 0 : 1,
    dbMs: ok ? dbMs : null,
    dnsMs: ok ? r.dnsMs : null,
    connectMs: ok ? r.connectMs : null,
    tlsMs: ok ? r.tlsMs : null,
    status: r.status,
    error: ok ? null : (r.error ?? `http_${r.status}`),
    at: new Date().toISOString(),
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Establish a session and warm the keep-alive socket before measuring.
const first = await signIn(false);
if (first.r.status !== 200) {
  console.error(`Sign-in failed with HTTP ${first.r.status}; check the fixture user`);
  process.exit(1);
}
for (const fn of Object.values(paths)) await fn(false);

// Auth paths are paced to stay under the default per-IP limits; RPC paths fill the gaps.
const authPlan = [];
for (let i = 0; i < COLD; i += 1) authPlan.push(["sign_in", "cold"], ["refresh", "cold"]);
for (let i = 0; i < WARM; i += 1) authPlan.push(["sign_in", "warm"], ["refresh", "warm"]);
const rpcPlan = [];
for (const name of Object.keys(paths)) {
  for (let i = 0; i < COLD; i += 1) rpcPlan.push([name, "cold"]);
  for (let i = 0; i < WARM; i += 1) rpcPlan.push([name, "warm"]);
}
// Interleave so every path sees the same time window.
for (let i = rpcPlan.length - 1; i > 0; i -= 1) {
  const j = next() % (i + 1);
  [rpcPlan[i], rpcPlan[j]] = [rpcPlan[j], rpcPlan[i]];
}

let lastAuth = 0;
let lastRpc = 0;
let authIndex = 0;
let rpcIndex = 0;
const started = Date.now();
while (authIndex < authPlan.length || rpcIndex < rpcPlan.length) {
  const now = Date.now();
  if (authIndex < authPlan.length && now - lastAuth >= AUTH_SPACING_MS / 2) {
    const [name, state] = authPlan[authIndex++];
    lastAuth = now;
    const result =
      name === "sign_in" ? await signIn(state === "cold") : await refresh(state === "cold");
    record(name, state, result);
    continue;
  }
  if (rpcIndex < rpcPlan.length && now - lastRpc >= RPC_SPACING_MS) {
    const [name, state] = rpcPlan[rpcIndex++];
    lastRpc = now;
    record(name, state, await paths[name](state === "cold"), name === "search" ? "any" : true);
    continue;
  }
  await sleep(250);
}

writeFileSync(outFile, JSON.stringify(samples, null, 2));
const failed = samples.filter((s) => !s.ok).length;
console.log(
  `${cfg.region}: ${samples.length} samples, ${failed} failed, ${Math.round((Date.now() - started) / 60000)} min`
);

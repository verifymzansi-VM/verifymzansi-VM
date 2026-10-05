#!/usr/bin/env node

import { createCloudflareRequest } from "./lib/cloudflare-api.mjs";
const token = process.env.CF_API_TOKEN;
const zoneId = process.env.CF_ZONE_ID || "05204c43f4378589a4cabecbe66917cc";
const apexDomain = process.env.CF_DOMAIN || "verifymzansi.com";
const wwwDomain = `www.${apexDomain}`;

if (!token) {
  console.error("Missing CF_API_TOKEN in environment.");
  process.exit(1);
}

const cfRequest = createCloudflareRequest(token);

async function ensureWwwCname() {
  const records = await cfRequest(
    "GET",
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(wwwDomain)}&type=CNAME`
  );

  if (Array.isArray(records) && records.length > 0) {
    const record = records[0];
    const updated = await cfRequest("PUT", `/zones/${zoneId}/dns_records/${record.id}`, {
      type: "CNAME",
      name: "www",
      content: apexDomain,
      proxied: true,
      ttl: 1,
    });
    console.log(`Updated www CNAME: ${updated.name} -> ${updated.content}`);
    return;
  }

  const created = await cfRequest("POST", `/zones/${zoneId}/dns_records`, {
    type: "CNAME",
    name: "www",
    content: apexDomain,
    proxied: true,
    ttl: 1,
  });

  console.log(`Created www CNAME: ${created.name} -> ${created.content}`);
}

async function ensureDnssecActive() {
  const before = await cfRequest("GET", `/zones/${zoneId}/dnssec`);
  if (before.status === "active") {
    console.log("DNSSEC already active in Cloudflare.");
    return before;
  }

  await cfRequest("PATCH", `/zones/${zoneId}/dnssec`, { status: "active" });
  const after = await cfRequest("GET", `/zones/${zoneId}/dnssec`);
  console.log(`DNSSEC status: ${after.status}`);
  return after;
}

async function main() {
  await ensureWwwCname();
  const dnssec = await ensureDnssecActive();

  if (dnssec?.ds) {
    console.log("DS record (publish at registrar):");
    console.log(dnssec.ds);
  } else {
    console.log(
      "DNSSEC enabled, but DS value unavailable in response. Check Cloudflare DNSSEC panel."
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

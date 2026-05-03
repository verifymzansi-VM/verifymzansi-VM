#!/usr/bin/env node
/* eslint-disable no-console */

const API_BASE = "https://api.cloudflare.com/client/v4";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const showHelp = args.has("--help") || args.has("-h");
const applyChanges = args.has("--apply");

const token = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const zoneId = process.env.CF_ZONE_ID || "05204c43f4378589a4cabecbe66917cc";
const domain = process.env.CF_DOMAIN || "verifymzansi.com";
const destinationEmail = process.env.CF_EMAIL_ROUTING_DESTINATION || "verifymzansi2s@gmail.com";
const routeName = process.env.CF_EMAIL_ROUTING_RULE_NAME || `Catch-all ${domain} -> ${destinationEmail}`;

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-email-routing-catch-all.mjs [--apply]\n\n` +
    `Configures a catch-all Cloudflare Email Routing rule for ${domain}.\n\n` +
    `Environment variables:\n` +
    `  CF_API_TOKEN or CLOUDFLARE_API_TOKEN             Cloudflare API token\n` +
    `  CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID           Cloudflare account ID\n` +
    `  CF_ZONE_ID                                       Cloudflare zone ID\n` +
    `  CF_DOMAIN                                        Zone apex domain\n` +
    `  CF_EMAIL_ROUTING_DESTINATION                     Destination inbox\n` +
    `  CF_EMAIL_ROUTING_RULE_NAME                       Catch-all rule name\n\n` +
    `Flags:\n` +
    `  --apply                                          Apply changes instead of dry-run\n` +
    `  --help                                           Show this help text`);
}

if (showHelp) {
  printHelp();
  process.exit(0);
}

if (!token) {
  console.error("Missing CF_API_TOKEN or CLOUDFLARE_API_TOKEN in environment.");
  process.exit(1);
}

if (!accountId) {
  console.error("Missing CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID in environment.");
  process.exit(1);
}

async function cfRequest(method, path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    const details = data?.errors?.map((error) => `${error.code}: ${error.message}`).join("; ") || response.statusText;
    throw new Error(`${method} ${path} failed: ${details}`);
  }

  return data.result;
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

async function getRoutingSettings() {
  return cfRequest("GET", `/zones/${zoneId}/email/routing`);
}

async function getRoutingDns() {
  return cfRequest("GET", `/zones/${zoneId}/email/routing/dns`);
}

async function listDestinationAddresses() {
  return cfRequest("GET", `/accounts/${accountId}/email/routing/addresses`);
}

async function ensureDestinationAddress() {
  const addresses = await listDestinationAddresses();
  const existing = Array.isArray(addresses)
    ? addresses.find((address) => address.email?.toLowerCase() === destinationEmail.toLowerCase())
    : null;

  if (existing) {
    console.log(`Destination exists: ${existing.email}${existing.verified ? " (verified)" : " (verification pending)"}`);
    return existing;
  }

  if (!applyChanges) {
    console.log(`[dry-run] Would create destination address ${destinationEmail}`);
    return null;
  }

  const created = await cfRequest("POST", `/accounts/${accountId}/email/routing/addresses`, {
    email: destinationEmail,
  });

  console.log(`Created destination address ${created.email}. Verification email should be sent by Cloudflare.`);
  return created;
}

async function ensureEmailRoutingEnabled() {
  const settings = await getRoutingSettings();
  const dns = await getRoutingDns();
  const isReady = settings?.enabled === true && settings?.status === "ready";

  console.log(`Current routing status: enabled=${String(settings?.enabled)} status=${settings?.status || "unknown"}`);

  if (isReady) {
    console.log("Email Routing is already enabled and ready.");
    return { settings, dns, changed: false };
  }

  if (!applyChanges) {
    console.log(`[dry-run] Would enable Email Routing DNS for ${domain}`);
    return { settings, dns, changed: false };
  }

  const enabled = await cfRequest("POST", `/zones/${zoneId}/email/routing/dns`, { name: domain });
  const refreshedDns = await getRoutingDns();
  console.log(`Email Routing DNS enabled: status=${enabled.status}`);
  return { settings: enabled, dns: refreshedDns, changed: true };
}

function printDnsRecords(dns) {
  const records = Array.isArray(dns) ? dns : Array.isArray(dns?.records) ? dns.records : [];
  if (records.length === 0) {
    console.log("No Email Routing DNS records returned by Cloudflare.");
    return;
  }

  console.log("Cloudflare Email Routing DNS records:");
  for (const record of records) {
    const proxied = typeof record.proxied === "boolean" ? ` proxied=${record.proxied}` : "";
    console.log(`- ${record.type} ${record.name} -> ${record.content}${proxied}`);
  }
}

async function getCatchAllRule() {
  try {
    return await cfRequest("GET", `/zones/${zoneId}/email/routing/rules/catch_all`);
  } catch (error) {
    if (String(error.message || error).includes("1002")) {
      return null;
    }
    throw error;
  }
}

async function ensureCatchAllRule() {
  const current = await getCatchAllRule();
  const desired = {
    actions: [{ type: "forward", value: [destinationEmail] }],
    enabled: true,
    matchers: [{ type: "all" }],
    name: routeName,
  };

  const alreadyMatches =
    current?.enabled === true &&
    current?.name === routeName &&
    Array.isArray(current?.actions) &&
    current.actions[0]?.type === "forward" &&
    Array.isArray(current.actions[0]?.value) &&
    current.actions[0].value.includes(destinationEmail);

  if (alreadyMatches) {
    console.log(`Catch-all rule already forwards to ${destinationEmail}.`);
    return current;
  }

  if (!applyChanges) {
    console.log(`[dry-run] Would set catch-all rule to forward all mail for ${domain} to ${destinationEmail}`);
    if (current) {
      console.log(`Current catch-all rule: ${JSON.stringify(current, null, 2)}`);
    }
    return current;
  }

  const updated = await cfRequest("PUT", `/zones/${zoneId}/email/routing/rules/catch_all`, desired);
  console.log(`Catch-all rule updated: ${updated.name}`);
  return updated;
}

async function main() {
  printSection("Cloudflare Email Routing Catch-All");
  console.log(`Mode: ${applyChanges ? "apply" : "dry-run"}`);
  console.log(`Zone: ${domain} (${zoneId})`);
  console.log(`Destination: ${destinationEmail}`);

  printSection("Destination Address");
  const destination = await ensureDestinationAddress();
  if (destination && !destination.verified) {
    console.log("Destination exists but is not verified yet. Complete the verification email before applying the catch-all rule.");
  }

  printSection("Email Routing DNS");
  const { dns } = await ensureEmailRoutingEnabled();
  printDnsRecords(dns);

  if (applyChanges && destination && !destination.verified) {
    console.log("Skipping catch-all rule update until the destination inbox is verified in Cloudflare.");
    return;
  }

  printSection("Catch-All Rule");
  await ensureCatchAllRule();

  printSection("Next Steps");
  console.log("1. If Cloudflare created a new destination, open the verification email in Gmail and confirm it.");
  console.log("2. Rerun this script with --apply after verification if the catch-all step was skipped.");
  console.log("3. Send test mail to support@, hello@, privacy@, security@, and a random alias at the domain.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
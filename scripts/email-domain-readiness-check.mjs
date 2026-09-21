#!/usr/bin/env node
/* eslint-disable no-console */

import { Resolver } from "node:dns/promises";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const jsonOutput = args.has("--json");
const strictMode = args.has("--strict");

const domain = process.env.EMAIL_DOMAIN || process.env.CF_DOMAIN || "verifymzansi.com";
const gmailInbox = process.env.EMAIL_GMAIL_INBOX || "verifymzansi2s@gmail.com";
const dkimSelectors = (process.env.EMAIL_DKIM_SELECTORS || "resend")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const publicResolver = new Resolver({ timeout: 2000, tries: 1 });
publicResolver.setServers(["1.1.1.1", "8.8.8.8"]);

function record(severity, name, detail, extra = {}) {
  return { severity, name, detail, ...extra };
}

async function resolveDns(name, type) {
  try {
    if (type === "TXT") {
      const answers = (await publicResolver.resolveTxt(name)).map((parts) => ({
        data: parts.join(""),
      }));
      if (answers.length > 0) {
        return { ok: true, provider: "public-dns", answers, status: 0 };
      }
    }

    if (type === "MX") {
      const answers = (await publicResolver.resolveMx(name)).map((record) => ({
        data: `${record.priority} ${record.exchange}${record.exchange.endsWith(".") ? "" : "."}`,
      }));
      if (answers.length > 0) {
        return { ok: true, provider: "public-dns", answers, status: 0 };
      }
    }
  } catch {
    // Fall through to DNS-over-HTTPS providers.
  }

  const providers = [
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
  ];

  let lastResult = { ok: false, provider: "", answers: [], status: -1 };

  for (const url of providers) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: {
          accept: "application/dns-json, application/json",
          "user-agent": "verifymzansi-email-domain-readiness/1.0",
        },
      });

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const answers = Array.isArray(payload?.Answer)
        ? payload.Answer.filter((answer) => answer.type === (type === "TXT" ? 16 : 15))
        : [];
      const result = {
        ok: true,
        provider: url,
        answers,
        status: Number(payload?.Status ?? 0),
      };

      lastResult = result;

      if (result.status === 0 && answers.length > 0) {
        return result;
      }
    } catch {
      // Try next provider.
    }
  }

  return lastResult;
}

function normalizeTxt(answer) {
  return String(answer?.data ?? "")
    .replace(/^"|"$/g, "")
    .replace(/"\s+"/g, "");
}

async function checkMx() {
  const result = await resolveDns(domain, "MX");
  if (!result.ok) {
    return record("fail", "MX lookup", `Could not resolve MX records for ${domain}.`);
  }

  const records = result.answers.map((answer) => String(answer?.data ?? ""));
  const hasCloudflareRouting = records.some((value) => /mx\.cloudflare\.net\.?$/i.test(value));

  if (records.length === 0) {
    return record("fail", "MX records", `No MX records published for ${domain}.`, { records });
  }

  return record(
    hasCloudflareRouting ? "pass" : "warn",
    "MX records",
    hasCloudflareRouting
      ? `Cloudflare Email Routing MX records detected for ${domain}.`
      : `MX records exist for ${domain}, but they do not look like Cloudflare Email Routing records.`,
    { records }
  );
}

async function checkSpf(name = domain) {
  const result = await resolveDns(name, "TXT");
  if (!result.ok) {
    return record("fail", "SPF lookup", `Could not resolve TXT records for ${name}.`);
  }

  const txtRecords = result.answers.map(normalizeTxt);
  const spfRecords = txtRecords.filter((value) => /^v=spf1\b/i.test(value));
  const spfRecord = spfRecords[0];
  if (spfRecords.length > 1) {
    return record("fail", `SPF (${name})`, "Multiple SPF records cause authentication errors.");
  }

  if (!spfRecord) {
    return record("fail", "SPF", `No SPF record found on ${name}.`, { records: txtRecords });
  }

  const includesResend = /include:spf\.resend\.com|include:amazonses\.com|resend/i.test(spfRecord);
  const isReturnPath = name !== domain;
  const detail = isReturnPath
    ? `Resend return-path SPF at ${name}: ${includesResend ? "sender included" : "sender include missing"}.`
    : `One SPF record at ${domain}. Resend authenticates its separate return-path subdomain; Google SPF alone does not verify Gmail alias sending.`;
  return record(isReturnPath && !includesResend ? "fail" : "pass", `SPF (${name})`, detail, {
    record: spfRecord,
  });
}

async function checkDmarc() {
  const name = `_dmarc.${domain}`;
  const result = await resolveDns(name, "TXT");
  if (!result.ok) {
    return record("fail", "DMARC lookup", `Could not resolve DMARC TXT for ${name}.`);
  }

  const txtRecords = result.answers.map(normalizeTxt);
  const dmarcRecord = txtRecords.find((value) => /^v=DMARC1\b/i.test(value));
  if (txtRecords.filter((value) => /^v=DMARC1\b/i.test(value)).length > 1) {
    return record("fail", "DMARC", "Multiple DMARC records are invalid.");
  }

  if (!dmarcRecord) {
    return record("fail", "DMARC", `No DMARC record found on ${name}.`, { records: txtRecords });
  }

  const hasRua = /\brua=/i.test(dmarcRecord);
  const hasRejectOrQuarantine = /\bp=(reject|quarantine)\b/i.test(dmarcRecord);
  return record(hasRejectOrQuarantine ? "pass" : "warn", "DMARC", dmarcRecord, {
    hasRua,
    hasRejectOrQuarantine,
  });
}

async function checkDkimSelectors() {
  const checks = [];

  for (const selector of dkimSelectors) {
    const fqdn = `${selector}._domainkey.${domain}`;
    const result = await resolveDns(fqdn, "TXT");
    const txtRecords = result.ok ? result.answers.map(normalizeTxt) : [];
    const dkimRecord = txtRecords.find((value) => /\bv=DKIM1\b/i.test(value) || /^p=/i.test(value));

    checks.push({ selector, fqdn, found: Boolean(dkimRecord), record: dkimRecord || "" });
  }

  const foundSelectors = checks.filter((check) => check.found);
  if (foundSelectors.length === 0) {
    return record(
      "warn",
      "DKIM selectors",
      `None of the checked DKIM selectors were found for ${domain}. Set EMAIL_DKIM_SELECTORS if your provider uses different selector names.`,
      { checks }
    );
  }

  if (foundSelectors.length !== checks.length) {
    return record(
      "warn",
      "DKIM selectors",
      "Some configured DKIM selectors are missing. Confirm the active sending providers.",
      { checks }
    );
  }

  return record(
    "pass",
    "DKIM selectors",
    `Found DKIM records for selector(s): ${foundSelectors.map((check) => check.selector).join(", ")}.`,
    { checks }
  );
}

function summarize(checks) {
  const failCount = checks.filter((check) => check.severity === "fail").length;
  const warnCount = checks.filter((check) => check.severity === "warn").length;
  const passCount = checks.filter((check) => check.severity === "pass").length;
  return { failCount, warnCount, passCount };
}

async function main() {
  const checks = [];

  checks.push(await checkMx());
  checks.push(await checkSpf());
  checks.push(await checkSpf(process.env.EMAIL_RETURN_PATH_DOMAIN || `send.${domain}`));
  const returnPathMx = await resolveDns(
    process.env.EMAIL_RETURN_PATH_DOMAIN || `send.${domain}`,
    "MX"
  );
  checks.push(
    record(
      returnPathMx.answers.some((a) => /feedback-smtp\..*\.amazonses\.com\.?$/i.test(a.data))
        ? "pass"
        : "fail",
      "Resend return-path MX",
      "Checks the separate Resend bounce-handling MX; root MX stays with Cloudflare."
    )
  );
  checks.push(await checkDmarc());
  checks.push(await checkDkimSelectors());

  const summary = summarize(checks);
  const nextSteps = [
    `Receive target inbox: ${gmailInbox}`,
    "Cloudflare Email Routing is required for inbox forwarding unless another mail host owns MX.",
    "Gmail Send mail as still requires alias verification in Gmail and a sender with proper SPF/DKIM alignment.",
    "DNS checks do not prove inbox delivery or verified Cloudflare destinations. Check routing status and provider delivery events separately.",
  ];

  if (jsonOutput) {
    console.log(
      JSON.stringify({ domain, gmailInbox, dkimSelectors, checks, summary, nextSteps }, null, 2)
    );
  } else {
    console.log(`Email domain readiness for ${domain}`);
    console.log("----------------------------------------");
    for (const check of checks) {
      const prefix =
        check.severity === "fail" ? "FAIL" : check.severity === "warn" ? "WARN" : "PASS";
      console.log(`${prefix}: ${check.name}: ${check.detail}`);
    }
    console.log("----------------------------------------");
    console.log(
      `Summary: ${summary.failCount} fail, ${summary.warnCount} warn, ${summary.passCount} pass`
    );
    console.log("Next steps:");
    for (const step of nextSteps) {
      console.log(`- ${step}`);
    }
  }

  if (strictMode && (summary.failCount > 0 || summary.warnCount > 0)) {
    process.exit(1);
  }

  if (summary.failCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

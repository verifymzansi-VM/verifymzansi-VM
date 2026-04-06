import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

const rawArgs = new Set(process.argv.slice(2));

type Target = {
  name: string;
  path: string;
  device?: (typeof devices)["Pixel 7"];
};

type RequestRecord = {
  id: string;
  target: string;
  method: string;
  url: string;
  resourceType: string;
  hasPostData: boolean;
  postDataBytes: number;
  isThirdParty: boolean;
  status?: number;
  failureText?: string;
};

type HeaderIssue = {
  severity: "warn" | "fail";
  detail: string;
};

type RuntimeIssue = {
  severity: "warn" | "fail";
  detail: string;
};

type TargetRiskSummary = {
  suspiciousPayloadCount: number;
  suspiciousPayloads: RequestRecord[];
  headerIssues: HeaderIssue[];
  runtimeIssues: RuntimeIssue[];
  actionableConsoleErrorCount: number;
  actionableCspViolationCount: number;
};

type TargetReport = {
  target: string;
  pageUrl: string;
  documentStatus: number;
  documentHeaders: {
    csp: string;
    hsts: string;
    xfo: string;
    xcto: string;
    referrerPolicy: string;
  };
  requestCount: number;
  payloadRequestCount: number;
  thirdPartyRequestCount: number;
  payloadRequests: RequestRecord[];
  thirdPartyHosts: string[];
  topRequests: RequestRecord[];
  consoleErrorCount: number;
  consoleErrorSamples: string[];
  cspViolationCount: number;
  cspViolationSamples: string[];
  mixedContentRequestCount: number;
  mixedContentRequests: string[];
  non2xxRequestCount: number;
  non2xxRequests: Array<{ method: string; url: string; status?: number; resourceType: string }>;
  riskSummary: TargetRiskSummary;
};

const baseUrl = process.env.PUBLIC_VERIFY_BASE_URL || "https://verifymzansi.com";
const loadSettleMs = Number(process.env.LIVE_LOAD_SETTLE_MS || "4000");
const artifactsDir = process.env.PUBLIC_VERIFY_ARTIFACTS_DIR || "test-results/public-verify";
const strictMode = process.env.LIVE_LOAD_STRICT === "1" || rawArgs.has("--strict");
const failOnSuspiciousPayload = process.env.LIVE_LOAD_FAIL_ON_SUSPICIOUS_PAYLOAD !== "0";
const failOnHeaderIssues = process.env.LIVE_LOAD_FAIL_ON_HEADER_ISSUES !== "0";
const failOnRuntimeIssues = process.env.LIVE_LOAD_FAIL_ON_RUNTIME_ISSUES !== "0";

const targets: Target[] = [
  { name: "home-desktop", path: "/" },
  { name: "login-desktop", path: "/login" },
  { name: "register-desktop", path: "/register" },
  { name: "pricing-desktop", path: "/pricing" },
  { name: "market-desktop", path: "/mzansi-market" },
  { name: "business-mobile", path: "/mzansi-business", device: devices["Pixel 7"] },
];

function hostOf(urlText: string): string {
  try {
    return new URL(urlText).hostname;
  } catch {
    return "";
  }
}

function isThirdPartyHost(host: string): boolean {
  if (!host) return true;
  return host !== "verifymzansi.com" && !host.endsWith(".verifymzansi.com");
}

function readHeader(headers: Record<string, string>, key: string): string {
  return headers[key] || "";
}

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isCloudflareExpectedPayload(url: string): boolean {
  const value = url.toLowerCase();
  return value.includes("/cdn-cgi/challenge-platform") || value.includes("/cdn-cgi/rum");
}

function classifyHeaderIssues(documentHeaders: TargetReport["documentHeaders"]): HeaderIssue[] {
  const issues: HeaderIssue[] = [];

  if (!documentHeaders.csp) {
    issues.push({ severity: "fail", detail: "Missing Content-Security-Policy" });
  }

  if (!documentHeaders.hsts || !documentHeaders.hsts.includes("max-age=")) {
    issues.push({ severity: "fail", detail: "Missing or invalid Strict-Transport-Security" });
  }

  if (!documentHeaders.xfo || !documentHeaders.xfo.toUpperCase().includes("DENY")) {
    issues.push({ severity: "warn", detail: "Missing or weak X-Frame-Options" });
  }

  if (!documentHeaders.xcto || !documentHeaders.xcto.toLowerCase().includes("nosniff")) {
    issues.push({ severity: "warn", detail: "Missing or weak X-Content-Type-Options" });
  }

  if (!documentHeaders.referrerPolicy) {
    issues.push({ severity: "warn", detail: "Missing Referrer-Policy" });
  }

  return issues;
}

function isKnownConsoleNoise(message: string, challengeOnly401: boolean): boolean {
  const value = message.toLowerCase();
  if (value.includes("permissions policy violation: xr-spatial-tracking")) {
    return true;
  }

  if (value.includes("script-src' was not explicitly set") && value.includes("default-src")) {
    return true;
  }

  if (value.includes("font-size:0;color:transparent") && value.includes("nan")) {
    return true;
  }

  if (
    challengeOnly401 &&
    value.includes("failed to load resource") &&
    value.includes("status of 401")
  ) {
    return true;
  }

  return false;
}

function isKnownCspNoise(violation: string, hasCloudflareChallengeHost: boolean): boolean {
  const value = violation.toLowerCase();
  if (hasCloudflareChallengeHost && value.includes("script-src") && value.includes("eval")) {
    return true;
  }

  return false;
}

function buildRiskSummary(
  payloadRequests: RequestRecord[],
  report: Omit<TargetReport, "riskSummary">
): TargetRiskSummary {
  const suspiciousPayloads = payloadRequests.filter((request) => {
    if (isCloudflareExpectedPayload(request.url)) {
      return false;
    }

    return true;
  });

  const runtimeIssues: RuntimeIssue[] = [];
  const hasCloudflareChallengeHost = report.thirdPartyHosts.includes("challenges.cloudflare.com");
  const challengeOnly401 =
    report.non2xxRequests.length > 0 &&
    report.non2xxRequests.every((request) => {
      try {
        const host = new URL(request.url).hostname;
        return host === "challenges.cloudflare.com" && request.status === 401;
      } catch {
        return false;
      }
    });
  const actionableConsoleErrors = report.consoleErrorSamples.filter(
    (message) => !isKnownConsoleNoise(message, challengeOnly401)
  );
  const actionableCspViolations = report.cspViolationSamples.filter(
    (violation) => !isKnownCspNoise(violation, hasCloudflareChallengeHost)
  );

  if (report.mixedContentRequestCount > 0) {
    runtimeIssues.push({
      severity: "fail",
      detail: `Mixed-content requests detected (${report.mixedContentRequestCount})`,
    });
  }

  if (actionableCspViolations.length > 0) {
    runtimeIssues.push({
      severity: "warn",
      detail: `CSP violations detected (${actionableCspViolations.length})`,
    });
  }

  if (actionableConsoleErrors.length > 0) {
    runtimeIssues.push({
      severity: "warn",
      detail: `Console/page runtime errors detected (${actionableConsoleErrors.length})`,
    });
  }

  return {
    suspiciousPayloadCount: suspiciousPayloads.length,
    suspiciousPayloads,
    headerIssues: classifyHeaderIssues(report.documentHeaders),
    runtimeIssues,
    actionableConsoleErrorCount: actionableConsoleErrors.length,
    actionableCspViolationCount: actionableCspViolations.length,
  };
}

async function auditTarget(target: Target): Promise<TargetReport> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(target.device ?? {});
  const page = await context.newPage();
  const requests = new Map<string, RequestRecord>();
  const requestIdByObject = new WeakMap<object, string>();
  const consoleErrors: string[] = [];

  await page.addInitScript(() => {
    (window as unknown as { __vmzCspViolations?: string[] }).__vmzCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      const record = `${event.violatedDirective} :: ${event.blockedURI}`;
      const targetWindow = window as unknown as { __vmzCspViolations?: string[] };
      targetWindow.__vmzCspViolations = targetWindow.__vmzCspViolations || [];
      targetWindow.__vmzCspViolations.push(record);
    });
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });

  page.on("request", (request) => {
    const host = hostOf(request.url());
    const postData = request.postDataBuffer();
    const id = makeRequestId();
    requestIdByObject.set(request, id);

    requests.set(id, {
      id,
      target: target.name,
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      hasPostData: Boolean(postData && postData.length > 0),
      postDataBytes: postData?.length ?? 0,
      isThirdParty: isThirdPartyHost(host),
    });
  });

  page.on("requestfailed", (request) => {
    const requestId = requestIdByObject.get(request);
    const entry = requestId ? requests.get(requestId) : undefined;
    if (entry) {
      entry.failureText = request.failure()?.errorText || "request failed";
    }
  });

  page.on("response", (response) => {
    const responseRequest = response.request();
    const requestId = requestIdByObject.get(responseRequest);
    const entry = requestId ? requests.get(requestId) : undefined;
    if (entry) {
      entry.status = response.status();
    }
  });

  const destination = new URL(target.path, baseUrl).toString();
  const documentResponse = await page.goto(destination, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  if (!documentResponse) {
    await context.close();
    await browser.close();
    throw new Error(`No response for ${target.name}`);
  }

  await page.waitForTimeout(loadSettleMs);

  const headers = documentResponse.headers();
  const requestList = [...requests.values()];
  const cspViolations = await page.evaluate(() => {
    const targetWindow = window as unknown as { __vmzCspViolations?: string[] };
    return targetWindow.__vmzCspViolations || [];
  });
  const mixedContentRequests = requestList
    .filter((request) => request.url.startsWith("http://"))
    .map((request) => request.url);
  const non2xxRequests = requestList
    .filter((request) => typeof request.status === "number" && (request.status ?? 0) >= 400)
    .map((request) => ({
      method: request.method,
      url: request.url,
      status: request.status,
      resourceType: request.resourceType,
    }));
  const payloadRequests = requestList.filter(
    (request) => request.hasPostData || ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
  );
  const thirdPartyHosts = [
    ...new Set(
      requestList
        .filter((request) => request.isThirdParty)
        .map((r) => hostOf(r.url))
        .filter(Boolean)
    ),
  ].sort();

  const report: TargetReport = {
    target: target.name,
    pageUrl: destination,
    documentStatus: documentResponse.status(),
    documentHeaders: {
      csp: readHeader(headers, "content-security-policy"),
      hsts: readHeader(headers, "strict-transport-security"),
      xfo: readHeader(headers, "x-frame-options"),
      xcto: readHeader(headers, "x-content-type-options"),
      referrerPolicy: readHeader(headers, "referrer-policy"),
    },
    requestCount: requestList.length,
    payloadRequestCount: payloadRequests.length,
    thirdPartyRequestCount: requestList.filter((request) => request.isThirdParty).length,
    payloadRequests,
    thirdPartyHosts,
    topRequests: requestList.slice(0, 25),
    consoleErrorCount: consoleErrors.length,
    consoleErrorSamples: consoleErrors.slice(0, 10),
    cspViolationCount: cspViolations.length,
    cspViolationSamples: cspViolations.slice(0, 10),
    mixedContentRequestCount: mixedContentRequests.length,
    mixedContentRequests: mixedContentRequests.slice(0, 20),
    non2xxRequestCount: non2xxRequests.length,
    non2xxRequests: non2xxRequests.slice(0, 20),
    riskSummary: {
      suspiciousPayloadCount: 0,
      suspiciousPayloads: [],
      headerIssues: [],
      runtimeIssues: [],
      actionableConsoleErrorCount: 0,
      actionableCspViolationCount: 0,
    },
  };

  report.riskSummary = buildRiskSummary(payloadRequests, report);

  await context.close();
  await browser.close();
  return report;
}

async function main() {
  const reports: TargetReport[] = [];

  for (const target of targets) {
    const report = await auditTarget(target);
    reports.push(report);
    process.stdout.write(
      `[AUDIT] ${target.name}: status=${report.documentStatus}, requests=${report.requestCount}, payloadRequests=${report.payloadRequestCount}, thirdPartyHosts=${report.thirdPartyHosts.join(",") || "none"}\n`
    );
  }

  const totalPayloadRequests = reports.reduce((sum, report) => sum + report.payloadRequestCount, 0);
  const totalSuspiciousPayloadRequests = reports.reduce(
    (sum, report) => sum + report.riskSummary.suspiciousPayloadCount,
    0
  );
  const headerIssueCount = reports.reduce(
    (sum, report) => sum + report.riskSummary.headerIssues.length,
    0
  );
  const runtimeIssueCount = reports.reduce(
    (sum, report) => sum + report.riskSummary.runtimeIssues.length,
    0
  );
  const uniqueThirdPartyHosts = [
    ...new Set(reports.flatMap((report) => report.thirdPartyHosts)),
  ].sort();

  const shouldFailFromSuspiciousPayload =
    failOnSuspiciousPayload && totalSuspiciousPayloadRequests > 0;
  const shouldFailFromHeaderIssues = failOnHeaderIssues && headerIssueCount > 0;
  const shouldFailFromRuntimeIssues = failOnRuntimeIssues && runtimeIssueCount > 0;
  const shouldFail =
    strictMode &&
    (shouldFailFromSuspiciousPayload || shouldFailFromHeaderIssues || shouldFailFromRuntimeIssues);

  const result = {
    baseUrl,
    auditedAt: new Date().toISOString(),
    loadSettleMs,
    strictMode,
    strictPolicy: {
      failOnSuspiciousPayload,
      failOnHeaderIssues,
      failOnRuntimeIssues,
    },
    strictFailure: shouldFail,
    totals: {
      targets: reports.length,
      payloadRequests: totalPayloadRequests,
      suspiciousPayloadRequests: totalSuspiciousPayloadRequests,
      headerIssues: headerIssueCount,
      runtimeIssues: runtimeIssueCount,
      uniqueThirdPartyHosts,
    },
    reports,
  };

  await mkdir(artifactsDir, { recursive: true });
  const outputPath = path.join(artifactsDir, `live-load-audit-${Date.now()}.json`);
  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

  process.stdout.write(`Live load audit report written to ${outputPath}\n`);

  if (strictMode) {
    process.stdout.write(
      `Strict mode summary: suspiciousPayloadRequests=${totalSuspiciousPayloadRequests}, headerIssues=${headerIssueCount}, runtimeIssues=${runtimeIssueCount}, strictFailure=${shouldFail}\n`
    );
  }

  if (shouldFail) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Live load audit failed:", error);
  process.exit(1);
});

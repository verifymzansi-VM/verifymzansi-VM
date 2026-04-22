const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function normalizeHost(host: string | null | undefined): string | null {
  if (typeof host !== "string") {
    return null;
  }

  const trimmed = host.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    const bracketEnd = trimmed.indexOf("]");
    return bracketEnd > 0 ? trimmed.slice(0, bracketEnd + 1) : trimmed;
  }

  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount <= 1) {
    return trimmed.split(":")[0] || null;
  }

  return trimmed;
}

function getIpv4Octets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return null;
  }

  const octets = match.slice(1).map((part) => Number(part));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function getHostnameFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }

  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

function isLocalDevelopmentHost(host: string | null | undefined): boolean {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    return false;
  }

  if (LOCALHOST_HOSTNAMES.has(normalizedHost) || normalizedHost.endsWith(".local")) {
    return true;
  }

  const ipv4Octets = getIpv4Octets(normalizedHost);
  if (!ipv4Octets) {
    return false;
  }

  const [first, second] = ipv4Octets;
  if (first === 10 || first === 127) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  return first === 172 && second >= 16 && second <= 31;
}

export function shouldBypassTurnstileInNonProduction(params: {
  currentHost: string | null | undefined;
  configuredAppUrl: string | null | undefined;
  nodeEnv?: string | undefined;
}): boolean {
  if (params.nodeEnv === "production") {
    return false;
  }

  const currentHost = normalizeHost(params.currentHost);
  if (!currentHost) {
    return false;
  }

  if (isLocalDevelopmentHost(currentHost)) {
    return true;
  }

  const configuredHost = getHostnameFromUrl(params.configuredAppUrl);
  if (!configuredHost) {
    return false;
  }

  return currentHost !== configuredHost;
}

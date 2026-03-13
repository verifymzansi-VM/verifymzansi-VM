export interface SecretScanRule {
  name: string;
  pattern: RegExp;
}

export interface SecretScanMatchContext {
  filePath: string;
  line: string;
  ruleName: string;
}

const FIXTURE_FILE_PATTERNS = [
  /(?:^|[\\/])scripts[\\/]start-playwright-server\.cjs$/i,
  /(?:^|[\\/])src[\\/].*?\.(?:test|spec)\.[jt]sx?$/i,
];

const FIXTURE_RULES = new Set([
  "Hardcoded service role key assignment",
  "PayFast passphrase",
  "Turnstile secret key",
  "Resend API key",
]);

const FIXTURE_MARKERS = ["playwright", "test", "stub", "dummy", "sandbox", "example"];

export const SECRET_SCAN_RULES: SecretScanRule[] = [
  {
    name: "Private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: "Stripe live secret",
    pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g,
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    name: "Supabase secret key",
    pattern: /\bsb_secret_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "Hardcoded service role key assignment",
    pattern: /\bSUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"'\n]{20,}["']/g,
  },
  {
    name: "PayFast passphrase",
    pattern: /\bPAYFAST_PASSPHRASE\s*[:=]\s*["'][^"'\n]{4,}["']/g,
  },
  {
    name: "Resend API key",
    pattern: /\bre_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "Cloudflare API token",
    pattern: /\bcf_[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    name: "Turnstile secret key",
    pattern: /\bTURNSTILE_SECRET_KEY\s*[:=]\s*["'][^"'\n]{10,}["']/g,
  },
  {
    name: "64-char hex string (potential encryption key)",
    pattern: /\b[0-9a-fA-F]{64}\b/g,
  },
];

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isAllowedLine(line: string): boolean {
  return line.includes("secret-scan: allow");
}

export function isDeterministicFixtureMatch({
  filePath,
  line,
  ruleName,
}: SecretScanMatchContext): boolean {
  if (!FIXTURE_RULES.has(ruleName)) {
    return false;
  }

  const normalizedPath = normalizeFilePath(filePath);
  if (!FIXTURE_FILE_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return false;
  }

  const normalizedLine = line.toLowerCase();
  return FIXTURE_MARKERS.some((marker) => normalizedLine.includes(marker));
}

export function shouldIgnoreSecretFinding(context: SecretScanMatchContext): boolean {
  return isAllowedLine(context.line) || isDeterministicFixtureMatch(context);
}

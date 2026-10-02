import "server-only";

import { createHash } from "node:crypto";

export { isAutomatedUserAgent } from "./automated-agent";

/**
 * One-way hash for viewer keys and network addresses, so stored analytics
 * cannot be linked back to a visitor (POPIA: no raw IPs are kept).
 */
export function hashAnalyticsKey(value: string): string {
  const configuredSecret = process.env.IP_HASH_SECRET || process.env.HMAC_SECRET;
  // A public fallback key would make the hashes reversible for IP addresses.
  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SECRET is not configured");
  }
  const secret = configuredSecret || "vm-analytics-dev";
  return createHash("sha256").update(`${secret}:${value}`).digest("hex").slice(0, 40);
}

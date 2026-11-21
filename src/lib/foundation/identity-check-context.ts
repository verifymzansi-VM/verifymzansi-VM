import "server-only";
import { createHmac } from "node:crypto";
import { verificationSecret } from "./verification-runtime";

/**
 * Where a member started an automatic ID check, compared with where the
 * partner saw the check happen. The session link is a bearer link: a scammer
 * could start a check and send the link to a victim. The database keeps only
 * a keyed hash of the member's network and the kind of device
 * (api.attach_identity_check_session); the partner receives neither.
 */
export type DeviceKind = "phone" | "computer";

/**
 * The network an address belongs to: IPv4 /24 ("4:198.51.100") or IPv6 /48
 * ("6:2001:db8:0"), or null when it cannot be read. A mobile network can move
 * a member to another address within the same block during a check.
 */
export function networkOf(address: string | null | undefined): string | null {
  const value = address?.trim().toLowerCase() ?? "";
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    return parts.every((part) => part <= 255) ? `4:${parts.slice(0, 3).join(".")}` : null;
  }
  if (!value.includes(":") || !/^[0-9a-f:]+$/.test(value)) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 2 ? missing < 1 : missing !== 0) || ![...head, ...tail].every(Boolean))
    return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.some((group) => group.length > 4)) return null;
  return `6:${groups
    .slice(0, 3)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}`;
}

/**
 * The keyed hash (HMAC-SHA256 with HMAC_SECRET, domain-separated) of an
 * address's network, as 64 hex characters. The first character is replaced by
 * the address kind ("4", "6", or "0" when the address cannot be read), so two
 * networks are compared only when they are of the same kind: a browser can
 * reach this site over IPv6 and the partner over IPv4.
 */
export function networkHash(address: string | null | undefined) {
  const network = networkOf(address);
  const digest = createHmac("sha256", verificationSecret("HMAC_SECRET"))
    .update(`identity-check-network-v1\0${network ?? "none"}`)
    .digest("hex");
  return (network ? network[0] : "0") + digest.slice(1);
}

/** Phone or tablet versus computer, from the browser's own description. */
export function deviceOfUserAgent(userAgent: string | null | undefined): DeviceKind {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? "") ? "phone" : "computer";
}

/** The partner's `platform` (mobile, tablet, desktop) in the same terms. */
export function deviceOfPlatform(platform: string | null | undefined): DeviceKind | null {
  const value = platform?.trim().toLowerCase();
  return value === "mobile" || value === "tablet"
    ? "phone"
    : value === "desktop"
      ? "computer"
      : null;
}

/**
 * True when the check did not happen on the network and kind of device that
 * started it. The partner's IP analysis is required (fail closed when it is
 * missing or the start was not recorded); networks are compared only when
 * both are known and of the same kind, and the device only when the partner
 * names it.
 */
export function sessionMoved(
  start: { network_hash: string | null; device_kind: string | null },
  seen: { ip_address?: string | null; platform?: string | null } | undefined
) {
  if (!seen || !start.network_hash || !start.device_kind) return true;
  const network = networkHash(seen.ip_address);
  const device = deviceOfPlatform(seen.platform);
  const networkMoved =
    start.network_hash[0] !== "0" &&
    network[0] === start.network_hash[0] &&
    network !== start.network_hash;
  return networkMoved || (device !== null && device !== start.device_kind);
}

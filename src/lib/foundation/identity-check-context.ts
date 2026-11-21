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
 * address's network, as 64 hex characters. An address that cannot be read
 * hashes the word "none", which never equals a real network's hash.
 */
export function networkHash(address: string | null | undefined) {
  return createHmac("sha256", verificationSecret("HMAC_SECRET"))
    .update(`identity-check-network-v1\0${networkOf(address) ?? "none"}`)
    .digest("hex");
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
 * True unless the partner saw the check on the same network and the same
 * kind of device that started it. Fails closed (owner rule: a different
 * network or device means a person looks): a missing IP analysis or start
 * record, an address that cannot be read on either side, an address of
 * another kind (IPv6 here, IPv4 there) and a device the partner does not name
 * all count as moved.
 */
export function sessionMoved(
  start: { network_hash: string | null; device_kind: string | null },
  seen: { ip_address?: string | null; platform?: string | null } | undefined
) {
  if (!seen || !start.network_hash || !start.device_kind) return true;
  if (networkOf(seen.ip_address) === null) return true;
  return (
    networkHash(seen.ip_address) !== start.network_hash ||
    deviceOfPlatform(seen.platform) !== start.device_kind
  );
}

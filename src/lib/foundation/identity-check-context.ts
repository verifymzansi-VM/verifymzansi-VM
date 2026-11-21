import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { verificationSecret } from "./verification-runtime";

/**
 * What the server knows when a member starts an automatic ID check, kept with
 * the partner session as one sealed value (AES-256-GCM, bound to the check
 * id) that the partner stores but cannot read:
 *
 * - the account, needed to encrypt the ID number for it;
 * - the legal names the member typed, passed back to the database exactly
 *   (`p_names`) and compared with the names on the ID;
 * - the member's network and kind of device, compared with what the partner
 *   saw during the check (the session link is a bearer link: a scammer could
 *   start a check and send the link to a victim).
 *
 * The key is derived from ID_ENCRYPTION_KEY for this purpose only.
 */
const contextSchema = z.strictObject({
  owner: z.uuid(),
  first: z.string().min(1).max(400),
  last: z.string().min(1).max(400),
  network: z.string().max(40).nullable(),
  device: z.enum(["handheld", "desktop"]),
});
export type IdentityCheckStartContext = z.infer<typeof contextSchema>;

const VERSION = "v1.";
const aad = (checkId: string) => Buffer.from(`identity-check-start-v1\0${checkId}`, "utf8");
const sealKey = () =>
  createHmac("sha256", verificationSecret("ID_ENCRYPTION_KEY"))
    .update("identity-check-seal-v1")
    .digest();

export function sealStartContext(checkId: string, context: IdentityCheckStartContext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(), iv);
  cipher.setAAD(aad(checkId));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(contextSchema.parse(context)), "utf8"),
    cipher.final(),
  ]);
  return VERSION + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** The sealed context of this check, or null when it is missing, altered or
 * belongs to another check. */
export function openStartContext(
  checkId: string,
  sealed: string | null | undefined
): IdentityCheckStartContext | null {
  if (!sealed?.startsWith(VERSION) || sealed.length > 4096) return null;
  try {
    const raw = Buffer.from(sealed.slice(VERSION.length), "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealKey(), raw.subarray(0, 12), {
      authTagLength: 16,
    });
    decipher.setAAD(aad(checkId));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const text = Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]).toString("utf8");
    const parsed = contextSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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

/** Phone or tablet versus computer, from the browser's own description. */
export function deviceOfUserAgent(userAgent: string | null | undefined) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent ?? "") ? "handheld" : "desktop";
}

/** The partner's `platform` (mobile, tablet, desktop) in the same terms. */
export function deviceOfPlatform(platform: string | null | undefined) {
  const value = platform?.trim().toLowerCase();
  return value === "mobile" || value === "tablet"
    ? "handheld"
    : value === "desktop"
      ? "desktop"
      : null;
}

/**
 * True when the check did not happen on the network and kind of device that
 * started it. The partner's IP analysis is required (fail closed when it is
 * missing); a network is compared only when both addresses are of the same
 * kind (a browser can reach this site over IPv6 and the partner over IPv4),
 * and a device only when the partner names it.
 */
export function sessionMoved(
  start: Pick<IdentityCheckStartContext, "network" | "device">,
  seen: { ip_address?: string | null; platform?: string | null } | undefined
) {
  if (!seen) return true;
  const network = networkOf(seen.ip_address);
  const device = deviceOfPlatform(seen.platform);
  const networkMoved =
    start.network !== null &&
    network !== null &&
    start.network.slice(0, 2) === network.slice(0, 2) &&
    start.network !== network;
  return networkMoved || (device !== null && device !== start.device);
}

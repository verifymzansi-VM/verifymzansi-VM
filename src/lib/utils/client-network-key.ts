import { getClientRateLimitIdentity } from "@/lib/utils/rate-limit";

/** Expands an IPv6 address to its eight groups, or null. */
function ipv6Groups(address: string): string[] | null {
  const plain = address
    .replace(/^\[|\]$/g, "")
    .split("%")[0]!
    .toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(plain) || plain.split("::").length > 2) return null;
  const [head, tail] = plain.includes("::") ? plain.split("::") : [plain, null];
  const split = (part: string | null | undefined) => (part ? part.split(":") : []);
  const left = split(head);
  const right = split(tail);
  // An embedded IPv4 tail counts as two groups.
  const last = (tail === null ? left : right).at(-1);
  if (last?.includes(".")) {
    const octets = last.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
      return null;
    const groups = [
      ((octets[0]! << 8) | octets[1]!).toString(16),
      ((octets[2]! << 8) | octets[3]!).toString(16),
    ];
    (tail === null ? left : right).splice(-1, 1, ...groups);
  }
  const missing = 8 - left.length - right.length;
  if (tail === null ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(tail === null ? 0 : missing).fill("0"), ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.replace(/^0+(?=.)/, ""));
}

type ClientAddress =
  | { family: "v4"; address: string }
  | { family: "v6"; groups: string[] }
  | { family: "unknown"; key: string };

function clientAddress(request: Request): ClientAddress {
  const identity = getClientRateLimitIdentity(request);
  const ip = identity.ip;
  if (!ip) return { family: "unknown", key: identity.key };
  if (!ip.includes(":")) return { family: "v4", address: ip };
  const groups = ipv6Groups(ip);
  if (!groups) return { family: "unknown", key: identity.key };
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const [high, low] = [parseInt(groups[6]!, 16), parseInt(groups[7]!, 16)];
    return { family: "v4", address: `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}` };
  }
  return { family: "v6", groups };
}

/**
 * Sign-up's two limiter keys: `address`, the IPv4 address or the IPv6 /64
 * (one host or home network), with the per-client limits; and `network`, the
 * IPv6 /48 (null for IPv4), with looser limits, so a host cannot rotate
 * through the /64s of its block. Without an address, `address` is the
 * request's fallback identity (getClientRateLimitIdentity).
 */
export function clientSignupKeys(request: Request): { address: string; network: string | null } {
  const client = clientAddress(request);
  if (client.family === "v4") return { address: `v4:${client.address}`, network: null };
  if (client.family === "v6")
    return {
      address: `v6:${client.groups.slice(0, 4).join(":")}::/64`,
      network: `v6:${client.groups.slice(0, 3).join(":")}::/48`,
    };
  return { address: client.key, network: null };
}

/**
 * The limiter key of a client's network: its IPv4 address, or the /48 network
 * of its IPv6 address (the block one site usually holds, so a host cannot
 * spread over its /64s); an IPv4-mapped IPv6 address is its IPv4 address.
 * Without an address, the request's fallback identity
 * (getClientRateLimitIdentity). Used by the view, like and identifier limits.
 */
export function clientNetworkKey(request: Request): string {
  const client = clientAddress(request);
  if (client.family === "v4") return `v4:${client.address}`;
  if (client.family === "v6") return `v6:${client.groups.slice(0, 3).join(":")}::/48`;
  return client.key;
}

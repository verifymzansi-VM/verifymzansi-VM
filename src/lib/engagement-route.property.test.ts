/** @vitest-environment node */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { engagementClientKey } from "./engagement-route";

// Property tests for the address key of the view and like limits (see
// src/app/api/engagement/engagement-routes.test.ts for named examples).

const from = (address: string) =>
  new Request("https://verifymzansi.com/api/engagement/like", {
    headers: { "cf-connecting-ip": address },
  });
const group = fc.integer({ min: 0, max: 0xffff });
const groups = fc.array(group, { minLength: 8, maxLength: 8 });
const hex = (value: number) => value.toString(16);

/** The other ways the same IPv6 address can be written. */
function spellings(parts: number[]) {
  const plain = parts.map(hex).join(":");
  const padded = parts.map((part) => hex(part).padStart(4, "0")).join(":");
  const spellings = [plain, padded, padded.toUpperCase(), `[${plain}]`, `${plain}%eth0`];
  // Compress the longest run of zero groups, if any.
  let best = { start: -1, length: 0 };
  for (let start = 0; start < 8; start += 1) {
    let length = 0;
    while (start + length < 8 && parts[start + length] === 0) length += 1;
    if (length > best.length) best = { start, length };
  }
  if (best.length > 0) {
    const head = parts.slice(0, best.start).map(hex).join(":");
    const tail = parts
      .slice(best.start + best.length)
      .map(hex)
      .join(":");
    spellings.push(`${head}::${tail}`);
  }
  return spellings;
}

describe("engagementClientKey", () => {
  it("gives every spelling of one IPv6 address the same key", () => {
    fc.assert(
      fc.property(groups, (parts) => {
        if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) return;
        const keys = spellings(parts).map((spelling) => engagementClientKey(from(spelling)));
        expect(new Set(keys).size).toBe(1);
      })
    );
  });

  it("gives addresses in one /48 network the same key and other networks different keys", () => {
    fc.assert(
      fc.property(groups, groups, (a, b) => {
        const network = (parts: number[]) => parts.slice(0, 3).join(":");
        if ([a, b].some((parts) => parts.slice(0, 5).every((part) => part === 0))) return;
        const sameNetwork = [...a.slice(0, 3), ...b.slice(3)];
        const key = (parts: number[]) => engagementClientKey(from(parts.map(hex).join(":")));
        expect(key(sameNetwork)).toBe(key(a));
        expect(key(a) === key(b)).toBe(network(a) === network(b));
      })
    );
  });

  it("gives an IPv4-mapped IPv6 address the key of its IPv4 address", () => {
    fc.assert(
      fc.property(fc.ipV4(), (address) => {
        const ipv4 = engagementClientKey(from(address));
        expect(ipv4).toBe(`v4:${address}`);
        expect(engagementClientKey(from(`::ffff:${address}`))).toBe(ipv4);
        const [a, b, c, d] = address.split(".").map(Number);
        const mapped = `::ffff:${hex((a << 8) | b)}:${hex((c << 8) | d)}`;
        expect(engagementClientKey(from(mapped))).toBe(ipv4);
      })
    );
  });

  it("never throws, and its key stays short", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.ipV6(), fc.ipV4(), fc.stringMatching(/^[0-9a-fA-F:.%[\]]{1,45}$/)),
        (address) => {
          const key = engagementClientKey(from(address));
          expect(key.length).toBeLessThanOrEqual(64);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

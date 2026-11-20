import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { limiterAccountAddressKey, limiterAddressKey } from "./limiter-key";

// Property tests for the rate limiter keys of typed values (see
// limiter-key.test.ts for named examples).

const email = fc.emailAddress();
const account = fc.uuid({ version: 4 });

describe("limiter keys", () => {
  it("have a fixed short shape the limiter accepts, whatever the address", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(email, fc.string({ unit: "binary", maxLength: 300 })),
        account,
        async (address, id) => {
          const single = await limiterAddressKey(address);
          const pair = await limiterAccountAddressKey(id, address);
          expect(single).toMatch(/^email:[0-9a-f]{64}$/);
          expect(pair).toMatch(/^account-email:[0-9a-f]{64}$/);
          expect(single.length).toBeLessThanOrEqual(160);
          expect(pair.length).toBeLessThanOrEqual(160);
        }
      )
    );
  });

  it("are the same for the same input and differ for different inputs", async () => {
    await fc.assert(
      fc.asyncProperty(email, email, account, account, async (a, b, first, second) => {
        expect(await limiterAddressKey(a)).toBe(await limiterAddressKey(a));
        expect((await limiterAddressKey(a)) === (await limiterAddressKey(b))).toBe(a === b);
        expect(
          (await limiterAccountAddressKey(first, a)) === (await limiterAccountAddressKey(second, a))
        ).toBe(first === second);
      })
    );
  });

  it("keep the two kinds of key apart even for the same text", async () => {
    await fc.assert(
      fc.asyncProperty(email, account, async (address, id) => {
        const single = (await limiterAddressKey(address)).split(":")[1];
        const pair = (await limiterAccountAddressKey(id, address)).split(":")[1];
        expect(single).not.toBe(pair);
      })
    );
  });
});

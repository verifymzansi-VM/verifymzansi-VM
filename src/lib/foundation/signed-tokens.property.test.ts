/** @vitest-environment node */
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readPhoneChallenge, sealPhoneChallenge } from "./phone-challenge-cookie";
import { derivedEnquiryRequestId } from "./public-enquiry";
import { issueViewerToken, readViewerToken } from "../engagement-cookie";

// Property tests for values this website signs or derives so they cannot be
// forged or replayed elsewhere: the phone-code challenge cookie, the browser
// identifier of the like and view counters, and the request id derived for a
// repeated enquiry. Named examples live in the routes' own tests.

const ACCOUNT = fc.uuid({ version: 4 });
const PHONE = fc.stringMatching(/^\+27[6-8][0-9]{8}$/);
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

beforeAll(() => {
  vi.stubEnv("FOUNDATION_PHONE_OTP_KEY", "0123456789abcdef".repeat(4));
  vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", "synthetic-engagement-secret-for-property-tests");
});
afterAll(() => vi.unstubAllEnvs());

/** The value with one character replaced by another allowed one. */
const tamper = (value: string, at: number, by: number) => {
  const index = at % value.length;
  const current = value[index]!;
  const alphabet = BASE64URL.includes(current) ? BASE64URL : "0123456789abcdef";
  const replacement =
    alphabet[(alphabet.indexOf(current) + 1 + (by % (alphabet.length - 1))) % alphabet.length]!;
  return value.slice(0, index) + replacement + value.slice(index + 1);
};
const refuses = (read: () => unknown) => {
  try {
    read();
    return false;
  } catch {
    return true;
  }
};

describe("the phone-code challenge cookie", () => {
  const expires = () => new Date(Date.now() + 120_000).toISOString();

  it("gives back the challenge for the same account and number", () => {
    fc.assert(
      fc.property(ACCOUNT, PHONE, fc.uuid(), (owner, phone, challenge) => {
        const cookie = sealPhoneChallenge(owner, phone, challenge, expires());
        expect(readPhoneChallenge(cookie, owner, phone)).toBe(challenge);
      })
    );
  });

  it("is refused for another account or another number (no replay across them)", () => {
    fc.assert(
      fc.property(
        ACCOUNT,
        ACCOUNT,
        PHONE,
        PHONE,
        fc.uuid(),
        (owner, other, phone, otherPhone, challenge) => {
          const cookie = sealPhoneChallenge(owner, phone, challenge, expires());
          if (other !== owner)
            expect(refuses(() => readPhoneChallenge(cookie, other, phone))).toBe(true);
          if (otherPhone !== phone)
            expect(refuses(() => readPhoneChallenge(cookie, owner, otherPhone))).toBe(true);
        }
      )
    );
  });

  it("is refused after any one-character change", () => {
    fc.assert(
      fc.property(
        ACCOUNT,
        PHONE,
        fc.uuid(),
        fc.nat(),
        fc.nat(),
        (owner, phone, challenge, at, by) => {
          const cookie = sealPhoneChallenge(owner, phone, challenge, expires());
          const changed = tamper(cookie, at, by);
          if (changed === cookie) return;
          expect(refuses(() => readPhoneChallenge(changed, owner, phone))).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("is refused once expired, and never lives longer than five minutes", () => {
    fc.assert(
      fc.property(
        ACCOUNT,
        PHONE,
        fc.uuid(),
        fc.integer({ min: 301, max: 86_400 }),
        (owner, phone, challenge, seconds) => {
          const later = new Date(Date.now() + seconds * 1000).toISOString();
          const cookie = sealPhoneChallenge(owner, phone, challenge, later);
          const payload = JSON.parse(Buffer.from(cookie.split(".")[0]!, "base64url").toString());
          expect(payload.expires_at).toBeLessThanOrEqual(Date.now() + 300_000);
        }
      )
    );
    expect(() =>
      sealPhoneChallenge(
        "11111111-1111-4111-8111-111111111111",
        "+27821234567",
        "22222222-2222-4222-8222-222222222222",
        new Date(Date.now() - 1000).toISOString()
      )
    ).toThrow();
  });
});

describe("the like and view browser identifier", () => {
  it("reads back what was issued, with its issue time", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 360 * 86_400 }), async (age) => {
        const issuedAt = Date.now() - age * 1000;
        const token = (await issueViewerToken(issuedAt))!;
        const read = await readViewerToken(token.value);
        expect(read?.id).toBe(token.id);
        expect(read?.issuedAt.getTime()).toBe(Math.floor(issuedAt / 1000) * 1000);
      })
    );
  });

  it("refuses any one-character change", async () => {
    const token = (await issueViewerToken())!;
    await fc.assert(
      fc.asyncProperty(fc.nat(), fc.nat(), async (at, by) => {
        const changed = tamper(token.value, at, by);
        if (changed === token.value) return;
        expect(await readViewerToken(changed)).toBeNull();
      }),
      { numRuns: 300 }
    );
  });

  it("refuses identifiers from the future or older than the cookie allows", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.integer({ min: 301, max: 10 ** 7 }),
          fc.integer({ min: -(10 ** 9), max: -(401 * 86_400) })
        ),
        async (offset) => {
          // One clock for issuing and reading: with two Date.now() calls a
          // second could tick between them and shrink the offset by one.
          const now = Date.now();
          const token = (await issueViewerToken(now + offset * 1000))!;
          expect(await readViewerToken(token.value, now)).toBeNull();
        }
      )
    );
  });

  it("accepts an identifier up to five minutes ahead of the reader's clock", async () => {
    // The edge of the window above, read with the same whole-second clock.
    const now = Math.floor(Date.now() / 1000) * 1000;
    const token = (await issueViewerToken(now + 300 * 1000))!;
    expect((await readViewerToken(token.value, now))?.id).toBe(token.id);
    const late = (await issueViewerToken(now + 301 * 1000))!;
    expect(await readViewerToken(late.value, now)).toBeNull();
  });
});

describe("the request id derived for an enquiry", () => {
  const command = fc.record(
    {
      p_request_id: fc.constant("00000000-0000-4000-8000-000000000000"),
      p_post_id: fc.uuid({ version: 4 }),
      p_sender: fc.uuid({ version: 4 }),
      p_buyer_name: fc.string({ minLength: 2, maxLength: 20 }),
      p_buyer_email: fc.emailAddress(),
      p_buyer_phone: PHONE,
      p_message: fc.string({ minLength: 10, maxLength: 60 }),
    },
    { requiredKeys: ["p_request_id", "p_post_id", "p_buyer_email", "p_message"] }
  );
  const day = fc.date({
    min: new Date("2026-01-01"),
    max: new Date("2030-12-31"),
    noInvalidDate: true,
  });

  it("is the same for a repeat on the same day, and a version 8 UUID a client cannot send", async () => {
    await fc.assert(
      fc.asyncProperty(command, day, async (input, now) => {
        const id = await derivedEnquiryRequestId(input, now);
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        const later = new Date(now);
        later.setUTCHours(23, 59, 59, 999);
        expect(await derivedEnquiryRequestId(input, later)).toBe(id);
      })
    );
  });

  it("changes when any detail or the day changes", async () => {
    await fc.assert(
      fc.asyncProperty(command, command, day, async (a, b, now) => {
        const same =
          a.p_post_id === b.p_post_id &&
          a.p_sender === b.p_sender &&
          a.p_buyer_name === b.p_buyer_name &&
          a.p_buyer_email === b.p_buyer_email &&
          a.p_buyer_phone === b.p_buyer_phone &&
          a.p_message === b.p_message;
        expect(
          (await derivedEnquiryRequestId(a, now)) === (await derivedEnquiryRequestId(b, now))
        ).toBe(same);
        const nextDay = new Date(now.getTime() + 86_400_000);
        expect(await derivedEnquiryRequestId(a, nextDay)).not.toBe(
          await derivedEnquiryRequestId(a, now)
        );
      })
    );
  });
});

/** @vitest-environment node */
import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  BUSINESS_CONTACT_OTP_PROTOCOL,
  createBusinessContactOtpCodec,
} from "./business-contact-otp";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const root = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const challenge = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const config = { key_id: "business-contact-otp-v1", key_hex: "0123456789abcdef".repeat(4) };
const subject = () => ({
  owner_id: owner,
  root_post_id: root,
  challenge_id: challenge,
  number: "+27112345678",
  method: "sms_otp",
});
afterEach(() => vi.restoreAllMocks());

it("binds a six-digit leading-zero code to the exact protocol and SQL-derived context", async () => {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    (array as Uint32Array)[0] = 42;
    return array;
  });
  const codec = await createBusinessContactOtpCodec(config);
  const result = await codec.create(subject());
  expect(result.code).toBe("000042");
  const expected = createHmac("sha256", Buffer.from(config.key_hex, "hex"))
    .update(
      JSON.stringify([
        "business-contact-otp-hmac-sha256-v1",
        "business-contact-otp-v1",
        "business-contact-number-control",
        owner,
        root,
        "+27112345678",
        challenge,
        "sms_otp",
        "000042",
      ]),
      "utf8"
    )
    .digest("hex");
  expect(result.digest).toEqual({
    protocol: BUSINESS_CONTACT_OTP_PROTOCOL,
    key_id: config.key_id,
    hash: expected,
  });
  expect(await codec.matches(subject(), result.code, result.digest)).toBe(true);
  expect(Object.keys(result).sort()).toEqual(["code", "digest"]);
  expect(JSON.stringify(codec)).toBe("{}");
});

it("refuses replay across account, business, destination, challenge or delivery method", async () => {
  const codec = await createBusinessContactOtpCodec(config);
  const issued = await codec.create(subject());
  for (const changed of [
    { owner_id: other },
    { root_post_id: other },
    { number: "+27821234567" },
    { challenge_id: other },
    { method: "voice_otp" },
  ])
    expect(await codec.matches({ ...subject(), ...changed }, issued.code, issued.digest)).toBe(
      false
    );
  expect(
    await codec.matches(subject(), issued.code === "000000" ? "000001" : "000000", issued.digest)
  ).toBe(false);
});

it("canonicalises UUID case but rejects noncanonical numbers and authority injection", async () => {
  const codec = await createBusinessContactOtpCodec(config);
  const issued = await codec.create({ ...subject(), owner_id: owner.toUpperCase() });
  expect(await codec.matches(subject(), issued.code, issued.digest)).toBe(true);
  for (const value of [
    { ...subject(), number: "0112345678" },
    { ...subject(), number: "+447123456789" },
    { ...subject(), verified: true },
    { ...subject(), method: "whatsapp" },
    { ...subject(), owner_id: "not-a-subject" },
  ]) {
    await expect(codec.create(value)).rejects.toThrow(
      /^Invalid business contact challenge context$/
    );
    await expect(codec.matches(value, issued.code, issued.digest)).rejects.toThrow(
      /^Invalid business contact challenge context$/
    );
  }
});

it("accepts only exact ASCII codes and canonical private digest metadata", async () => {
  const codec = await createBusinessContactOtpCodec(config);
  const issued = await codec.create(subject());
  for (const code of [Number(issued.code), "12345", "1234567", " 123456", "１２３４５６", null])
    expect(await codec.matches(subject(), code, issued.digest)).toBe(false);
  for (const digest of [
    { ...issued.digest, protocol: "account-phone-otp" },
    { ...issued.digest, key_id: "business-contact-otp-v2" },
    { ...issued.digest, hash: issued.digest.hash.toUpperCase() },
    { ...issued.digest, hash: "0".repeat(63) },
    { ...issued.digest, verified: true },
    null,
  ])
    expect(await codec.matches(subject(), issued.code, digest)).toBe(false);
});

it("separates key versions and keys even for an identical OTP and context", async () => {
  const first = await createBusinessContactOtpCodec(config);
  const issued = await first.create(subject());
  const rotated = await createBusinessContactOtpCodec({
    ...config,
    key_id: "business-contact-otp-v2",
  });
  const different = await createBusinessContactOtpCodec({
    ...config,
    key_hex: "fedcba9876543210".repeat(4),
  });
  expect(await rotated.matches(subject(), issued.code, issued.digest)).toBe(false);
  expect(await different.matches(subject(), issued.code, issued.digest)).toBe(false);
});

it("rejects incomplete key configuration without returning sensitive input", async () => {
  for (const input of [
    undefined,
    {},
    { ...config, key_id: "identity-match-v1" },
    { ...config, key_hex: "secret" },
    { ...config, key_hex: "0".repeat(62) },
    { ...config, key_hex: config.key_hex.toUpperCase() },
    { ...config, key_hex: "0".repeat(66) },
    { ...config, owner_id: owner },
  ])
    await expect(createBusinessContactOtpCodec(input)).rejects.toThrow(
      /^Valid business contact OTP key required$/
    );
});

it("discards the biased tail of random values and bounds unavailable randomness", async () => {
  const random = vi.spyOn(crypto, "getRandomValues");
  random.mockImplementationOnce((array) => {
    (array as Uint32Array)[0] = 0xffffffff;
    return array;
  });
  random.mockImplementationOnce((array) => {
    (array as Uint32Array)[0] = 999999;
    return array;
  });
  const codec = await createBusinessContactOtpCodec(config);
  expect((await codec.create(subject())).code).toBe("999999");
  expect(random).toHaveBeenCalledTimes(2);
  random.mockClear().mockImplementation((array) => {
    (array as Uint32Array)[0] = 0xffffffff;
    return array;
  });
  await expect(codec.create(subject())).rejects.toThrow(
    /^Business contact challenge generation unavailable$/
  );
  expect(random).toHaveBeenCalledTimes(8);
});

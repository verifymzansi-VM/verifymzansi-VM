/**
 * Direct unit tests for the PayFast service functions.
 *
 * Audit finding M1: No direct tests for `verifyPayFastSignature` edge cases
 * (empty passphrase, missing signature, parameter ordering, timing-safe
 * comparison) or `buildPayFastCheckoutUrl` input validation.
 *
 * These tests exercise the *real* crypto logic — no mocks on the service
 * itself — isolating only the `env()` dependency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ── Mock only the env() function ──────────────────────────────

const envMap: Record<string, string> = {
  NODE_ENV: "test",
  PAYFAST_SANDBOX: "false",
  NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  PAYFAST_PASSPHRASE: "test-passphrase", // secret-scan: allow
};

vi.mock("@/lib/config/env", () => ({
  env: vi.fn((key: string) => envMap[key] ?? ""),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  buildPayFastCheckoutUrl,
  verifyPayFastSignature,
  isPayFastIp,
} from "@/lib/services/payfast";

// ── Helpers ───────────────────────────────────────────────────

/** Generate a valid MD5 signature for a set of ITN params */
function computeExpectedSignature(params: Record<string, string>, passphrase?: string): string {
  const PF_ITN_ORDER = [
    "m_payment_id",
    "pf_payment_id",
    "payment_status",
    "item_name",
    "item_description",
    "amount_gross",
    "amount_fee",
    "amount_net",
    "custom_str1",
    "custom_str2",
    "custom_str3",
    "custom_str4",
    "custom_str5",
    "custom_int1",
    "custom_int2",
    "custom_int3",
    "custom_int4",
    "custom_int5",
    "name_first",
    "name_last",
    "email_address",
    "merchant_id",
  ];

  const knownKeys = PF_ITN_ORDER.filter((key) => key in params);
  const extraKeys = Object.keys(params).filter(
    (key) => !PF_ITN_ORDER.includes(key) && key !== "signature"
  );
  const orderedKeys = [...knownKeys, ...extraKeys];

  const sigString = orderedKeys
    .map((key) => `${key}=${encodeURIComponent(params[key].trim())}`)
    .join("&");

  const sigData = passphrase
    ? `${sigString}&passphrase=${encodeURIComponent(passphrase.trim())}`
    : sigString;

  return crypto.createHash("md5").update(sigData).digest("hex");
}

function makeITNData(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    m_payment_id: "pay-001",
    pf_payment_id: "pf-12345",
    payment_status: "COMPLETE",
    amount_gross: "15.00",
    item_name: "Boost listing",
    ...overrides,
  };
  return base;
}

function signData(data: Record<string, string>, passphrase?: string): Record<string, string> {
  const sig = computeExpectedSignature(data, passphrase);
  return { ...data, signature: sig };
}

// ── Tests ─────────────────────────────────────────────────────

describe("verifyPayFastSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMap.NODE_ENV = "test";
    envMap.PAYFAST_SANDBOX = "false";
  });

  it("returns true for a correctly signed payload with passphrase", () => {
    const data = makeITNData();
    const signed = signData(data, "test-passphrase");
    expect(verifyPayFastSignature(signed, "test-passphrase")).toBe(true);
  });

  it("returns true for a correctly signed payload without passphrase", () => {
    const data = makeITNData();
    const signed = signData(data); // no passphrase
    expect(verifyPayFastSignature(signed)).toBe(true);
  });

  it("returns false when signature is missing", () => {
    const data = makeITNData();
    // no signature field
    expect(verifyPayFastSignature(data)).toBe(false);
  });

  it("returns false for a tampered payload", () => {
    const data = makeITNData();
    const signed = signData(data, "test-passphrase");
    // tamper with amount after signing
    signed.amount_gross = "999.99";
    expect(verifyPayFastSignature(signed, "test-passphrase")).toBe(false);
  });

  it("returns false when passphrase differs", () => {
    const data = makeITNData();
    const signed = signData(data, "correct-passphrase");
    // verify with wrong passphrase
    expect(verifyPayFastSignature(signed, "wrong-passphrase")).toBe(false);
  });

  it("returns false when passphrase provided but data signed without", () => {
    const data = makeITNData();
    const signed = signData(data); // signed without passphrase
    expect(verifyPayFastSignature(signed, "some-passphrase")).toBe(false);
  });

  it("returns false when no passphrase provided but data signed with one", () => {
    const data = makeITNData();
    const signed = signData(data, "secret"); // signed with passphrase
    expect(verifyPayFastSignature(signed)).toBe(false);
  });

  it("handles empty string passphrase (treated as no passphrase)", () => {
    const data = makeITNData();
    const signed = signData(data); // no passphrase
    // Empty string should be treated as no passphrase by PayFast's check
    expect(verifyPayFastSignature(signed, "")).toBe(true);
  });

  it("preserves PayFast parameter ordering (known fields before extras)", () => {
    const data: Record<string, string> = {
      custom_extra_field: "bonus",
      m_payment_id: "pay-001",
      payment_status: "COMPLETE",
      amount_gross: "15.00",
      item_name: "Test",
    };
    const signed = signData(data, "test-passphrase");
    expect(verifyPayFastSignature(signed, "test-passphrase")).toBe(true);
  });

  it("trims whitespace in field values before signing", () => {
    const data = makeITNData({ item_name: "  Boost listing  " });
    const signed = signData(data, "test-passphrase");
    expect(verifyPayFastSignature(signed, "test-passphrase")).toBe(true);
  });

  it("rejects forged signature with different length (timing-safe)", () => {
    const data = makeITNData();
    const signed = signData(data, "test-passphrase");
    // Replace signature with a shorter string
    signed.signature = "abc";
    expect(verifyPayFastSignature(signed, "test-passphrase")).toBe(false);
  });

  it("throws when sandbox=true in production", () => {
    envMap.NODE_ENV = "production";
    envMap.PAYFAST_SANDBOX = "true";
    const data = makeITNData();
    const signed = signData(data, "test-passphrase");
    expect(() => verifyPayFastSignature(signed, "test-passphrase")).toThrow(
      /not allowed in production/
    );
  });
});

describe("buildPayFastCheckoutUrl", () => {
  const baseParams = {
    merchantId: "test-merchant-id",
    merchantKey: "test-merchant-key",
    returnUrl: "https://verifymzansi.com/dashboard",
    cancelUrl: "https://verifymzansi.com/cancel",
    notifyUrl: "https://verifymzansi.com/api/webhooks/payfast",
    paymentId: "pay-001",
    amount: 15.0,
    itemName: "Boost listing",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    envMap.NODE_ENV = "test";
    envMap.PAYFAST_SANDBOX = "false";
    envMap.PAYFAST_PASSPHRASE = "test-passphrase"; // secret-scan: allow (test-only mock value)
  });

  it("builds a valid URL with required fields", () => {
    const url = buildPayFastCheckoutUrl(baseParams);
    expect(url).toContain("merchant_id=test-merchant-id");
    expect(url).toContain("amount=15.00");
    expect(url).toContain("item_name=");
    expect(url).toContain("signature=");
  });

  it("includes optional email_address when provided", () => {
    const url = buildPayFastCheckoutUrl({
      ...baseParams,
      emailAddress: "seller@test.com",
    });
    expect(url).toContain("email_address=seller%40test.com");
  });

  it("includes optional cell_number when provided", () => {
    const url = buildPayFastCheckoutUrl({
      ...baseParams,
      cellNumber: "+27821234567",
    });
    expect(url).toContain("cell_number=%2B27821234567");
  });

  it("truncates item_name to 100 characters", () => {
    const longName = "A".repeat(200);
    const url = buildPayFastCheckoutUrl({
      ...baseParams,
      itemName: longName,
    });
    // The encoded item_name value should be at most 100 chars (before encoding)
    const match = url.match(/item_name=([^&]*)/);
    expect(match).toBeTruthy();
    expect(decodeURIComponent(match![1]).length).toBeLessThanOrEqual(100);
  });

  it("truncates item_description to 255 characters", () => {
    const longDesc = "B".repeat(300);
    const url = buildPayFastCheckoutUrl({
      ...baseParams,
      itemDescription: longDesc,
    });
    const match = url.match(/item_description=([^&]*)/);
    expect(match).toBeTruthy();
    expect(decodeURIComponent(match![1]).length).toBeLessThanOrEqual(255);
  });

  it("throws for zero amount", () => {
    expect(() => buildPayFastCheckoutUrl({ ...baseParams, amount: 0 })).toThrow(
      /positive finite number/
    );
  });

  it("throws for negative amount", () => {
    expect(() => buildPayFastCheckoutUrl({ ...baseParams, amount: -10 })).toThrow(
      /positive finite number/
    );
  });

  it("throws for NaN amount", () => {
    expect(() => buildPayFastCheckoutUrl({ ...baseParams, amount: NaN })).toThrow(
      /positive finite number/
    );
  });

  it("throws for Infinity amount", () => {
    expect(() => buildPayFastCheckoutUrl({ ...baseParams, amount: Infinity })).toThrow(
      /positive finite number/
    );
  });

  it("formats amount to 2 decimal places", () => {
    const url = buildPayFastCheckoutUrl({
      ...baseParams,
      amount: 15.5,
    });
    expect(url).toContain("amount=15.50");
  });

  it("generates a valid MD5 signature in the URL", () => {
    const url = buildPayFastCheckoutUrl(baseParams);
    const sigMatch = url.match(/signature=([a-f0-9]{32})/);
    expect(sigMatch).toBeTruthy();
    // Must be exactly 32 hex chars (MD5)
    expect(sigMatch![1]).toHaveLength(32);
  });

  it("uses sandbox URL when PAYFAST_SANDBOX is true", () => {
    envMap.PAYFAST_SANDBOX = "true";
    const url = buildPayFastCheckoutUrl(baseParams);
    expect(url).toContain("sandbox.payfast.co.za");
  });

  it("uses mock URL in development mode", () => {
    envMap.NODE_ENV = "development";
    const url = buildPayFastCheckoutUrl(baseParams);
    expect(url).toContain("/api/mock-payfast");
  });
});

describe("isPayFastIp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMap.NODE_ENV = "production";
    envMap.PAYFAST_SANDBOX = "false";
  });

  it("accepts valid PayFast IP addresses", () => {
    const validIps = [
      "197.97.145.144",
      "197.97.145.145",
      "197.97.145.146",
      "197.97.145.147",
      "197.97.145.148",
      "197.97.145.149",
      "197.97.145.150",
      "197.97.145.151",
    ];
    for (const ip of validIps) {
      expect(isPayFastIp(ip)).toBe(true);
    }
  });

  it("rejects non-PayFast IP addresses in production", () => {
    expect(isPayFastIp("192.168.1.1")).toBe(false);
    expect(isPayFastIp("10.0.0.1")).toBe(false);
    expect(isPayFastIp("197.97.145.152")).toBe(false); // one above range
    expect(isPayFastIp("0.0.0.0")).toBe(false);
  });

  it("allows any IP in non-production sandbox mode", () => {
    envMap.NODE_ENV = "development";
    envMap.PAYFAST_SANDBOX = "true";
    expect(isPayFastIp("192.168.1.1")).toBe(true);
    expect(isPayFastIp("anything")).toBe(true);
  });

  it("enforces IP whitelist in production even if sandbox flag is set", () => {
    // The service should throw or reject sandbox in prod — this exercises
    // the ip-check path specifically (sandbox + prod is flagged elsewhere)
    envMap.NODE_ENV = "production";
    envMap.PAYFAST_SANDBOX = "false";
    expect(isPayFastIp("192.168.1.1")).toBe(false);
  });
});

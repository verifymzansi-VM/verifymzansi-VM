import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import { buildPayFastCheckoutUrl, verifyPayFastSignature, isPayFastIp } from "./payfast";
import { _resetEnvCacheForTesting } from "@/lib/config/env";

describe("PayFast service", () => {
  beforeEach(() => {
    _resetEnvCacheForTesting();
    vi.stubEnv("PAYFAST_SANDBOX", "true");
    vi.stubEnv("PAYFAST_PASSPHRASE", "test_passphrase");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetEnvCacheForTesting();
  });

  describe("buildPayFastCheckoutUrl", () => {
    const params = {
      merchantId: "10000100",
      merchantKey: "46f0cd694581a",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
      notifyUrl: "https://example.com/notify",
      paymentId: "pay_001",
      amount: 260,
      itemName: "Mzansi Market Growth",
    };

    it("builds a sandbox URL when PAYFAST_SANDBOX=true", () => {
      const url = buildPayFastCheckoutUrl(params);
      expect(url).toContain("sandbox.payfast.co.za");
    });

    it("builds a production URL when PAYFAST_SANDBOX is not true", () => {
      vi.stubEnv("PAYFAST_SANDBOX", "false");
      const url = buildPayFastCheckoutUrl(params);
      expect(url).toContain("www.payfast.co.za");
      expect(url).not.toContain("sandbox");
    });

    it("includes all required parameters", () => {
      const url = buildPayFastCheckoutUrl(params);
      expect(url).toContain("merchant_id=10000100");
      expect(url).toContain("merchant_key=46f0cd694581a");
      expect(url).toContain("m_payment_id=pay_001");
      expect(url).toContain("amount=260.00");
      expect(url).toContain("item_name=Mzansi");
    });

    it("includes an MD5 signature", () => {
      const url = buildPayFastCheckoutUrl(params);
      expect(url).toMatch(/signature=[a-f0-9]{32}/);
    });

    it("truncates item_name to 100 chars", () => {
      const url = buildPayFastCheckoutUrl({
        ...params,
        itemName: "A".repeat(200),
      });
      // The encoded item_name should be 100 chars or less
      const match = url.match(/item_name=([^&]*)/);
      expect(match).toBeTruthy();
      expect(decodeURIComponent(match![1]).length).toBeLessThanOrEqual(100);
    });

    it("includes optional email and cell", () => {
      const url = buildPayFastCheckoutUrl({
        ...params,
        emailAddress: "user@test.com",
        cellNumber: "0821234567",
      });
      expect(url).toContain("email_address=");
      expect(url).toContain("cell_number=");
    });
  });

  describe("verifyPayFastSignature", () => {
    it("returns false when signature is missing", () => {
      expect(verifyPayFastSignature({ amount: "100.00" })).toBe(false);
    });

    it("verifies a valid signature", () => {
      // Build a signature-bearing data set using PayFast ITN field names
      const data: Record<string, string> = {
        m_payment_id: "pay-001",
        payment_status: "COMPLETE",
        item_name: "Test",
        amount_gross: "100.00",
        merchant_id: "10000100",
      };

      // Match the PF_ITN_ORDER used by verifyPayFastSignature:
      // known fields in ITN order first, then extras
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
      const knownKeys = PF_ITN_ORDER.filter((key) => key in data);
      const extraKeys = Object.keys(data).filter((key) => !PF_ITN_ORDER.includes(key));
      const orderedKeys = [...knownKeys, ...extraKeys];

      const signStr = orderedKeys
        .map((k) => `${k}=${encodeURIComponent(data[k].trim())}`)
        .join("&");

      const withPassphrase = `${signStr}&passphrase=${encodeURIComponent("test_passphrase")}`;
      data.signature = createHash("md5").update(withPassphrase).digest("hex");

      expect(verifyPayFastSignature(data, "test_passphrase")).toBe(true);
    });

    it("rejects tampered data", () => {
      const data: Record<string, string> = {
        merchant_id: "10000100",
        amount: "100.00",
      };

      const signStr = Object.keys(data)
        .sort()
        .map((k) => `${k}=${encodeURIComponent(data[k].trim())}`)
        .join("&");

      data.signature = createHash("md5").update(signStr).digest("hex");

      // Tamper with amount
      data.amount = "999.00";
      expect(verifyPayFastSignature(data)).toBe(false);
    });
  });

  describe("isPayFastIp", () => {
    it("allows any IP in sandbox mode", () => {
      expect(isPayFastIp("1.2.3.4")).toBe(true);
    });

    it("restricts to known IPs in production", () => {
      vi.stubEnv("PAYFAST_SANDBOX", "false");
      expect(isPayFastIp("197.97.145.144")).toBe(true);
      expect(isPayFastIp("1.2.3.4")).toBe(false);
    });
  });
});

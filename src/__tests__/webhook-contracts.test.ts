import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  EmailProviderResponseSchema,
  KycWebhookPayloadSchema,
  SmsProviderResponseSchema,
} from "@/test/contracts/webhooks";

const FIXTURE_ROOT = path.join(process.cwd(), "src", "test", "fixtures", "contracts");

function readFixture<T>(segments: string[]): T {
  const fullPath = path.join(FIXTURE_ROOT, ...segments);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as T;
}

describe("Webhook and Provider Contract Fixtures", () => {
  it("accepts KYC approved payload fixture", () => {
    const payload = readFixture<Record<string, unknown>>(["kyc", "provider-approved.json"]);

    const parsed = KycWebhookPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("accepts KYC rejected payload fixture", () => {
    const payload = readFixture<Record<string, unknown>>(["kyc", "provider-rejected.json"]);

    const parsed = KycWebhookPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("accepts Africa's Talking success payload fixture", () => {
    const payload = readFixture<Record<string, unknown>>(["sms", "africastalking-success.json"]);

    const parsed = SmsProviderResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("accepts Africa's Talking failure payload fixture", () => {
    const payload = readFixture<Record<string, unknown>>(["sms", "africastalking-failure.json"]);

    const parsed = SmsProviderResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("accepts Resend success payload fixture", () => {
    const payload = readFixture<Record<string, unknown>>(["email", "resend-success.json"]);

    const parsed = EmailProviderResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("accepts Resend error payload fixture", () => {
    const payload = readFixture<Record<string, unknown>>(["email", "resend-error.json"]);

    const parsed = EmailProviderResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("rejects KYC payload with invalid status", () => {
    const payload = readFixture<Record<string, unknown>>(["kyc", "provider-approved.json"]);
    payload.status = "pass";

    const parsed = KycWebhookPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("rejects SMS payload without recipients", () => {
    const payload = readFixture<Record<string, unknown>>(["sms", "africastalking-success.json"]);
    payload.SMSMessageData = { Message: "ok", Recipients: [] };

    const parsed = SmsProviderResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("rejects email payload missing both data and error", () => {
    const parsed = EmailProviderResponseSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});

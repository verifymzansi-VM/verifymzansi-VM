import { expect, it } from "vitest";
import { getDataBackend } from "@/lib/data-backend";

it("keeps source fixtures deterministic when the audit runner loads foundation deployment settings", () => {
  expect(getDataBackend()).toBe("source");
});

it("removes live foundation service authority before application imports", () => {
  for (const name of [
    "FOUNDATION_SUPABASE_SECRET_KEY",
    "FOUNDATION_PHONE_OTP_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "INTERNAL_JOBS_SECRET",
    "OPS_JOBS_SECRET",
    "KYC_WEBHOOK_SECRET",
  ])
    // Test presence only so an isolation failure cannot print a live secret.
    expect(name in process.env, `${name} must be absent from unit tests`).toBe(false);
});

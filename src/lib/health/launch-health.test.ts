import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuditFailureCount } from "@/lib/services/audit";
import { getLaunchHealthSnapshot } from "./launch-health";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/services/audit", () => ({
  getAuditFailureCount: vi.fn(),
}));

const VALID_PRODUCTION_ENV = {
  NODE_ENV: "production",
  VERIFYMZANSI_RUNTIME_MODE: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value-1234567890",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-1234567890", // secret-scan: allow deterministic fixture
  NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  AFRICASTALKING_API_KEY: "africas-talking-key",
  AFRICASTALKING_USERNAME: "verifymzansi",
  AFRICASTALKING_SENDER_ID: "VERIFYMZANS",
  OZOW_ENV: "production",
  OZOW_CLIENT_ID: "client-id-value",
  OZOW_CLIENT_SECRET: "client-secret-value", // secret-scan: allow deterministic fixture
  OZOW_SITE_CODE: "site-code",
  OZOW_WEBHOOK_SECRET: "webhook-secret-value", // secret-scan: allow deterministic fixture
  RESEND_API_KEY: "re_test_1234567890",
  R2_ACCOUNT_ID: "cloudflare-account-id",
  R2_ACCESS_KEY_ID: "cloudflare-access-key",
  R2_SECRET_ACCESS_KEY: "cloudflare-secret-key",
  KYC_ENCRYPTION_KEY: "a".repeat(64),
  ID_ENCRYPTION_KEY: "b".repeat(64),
  HMAC_SECRET: "c".repeat(64),
  IP_HASH_SECRET: "p".repeat(32),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA_test_site_key",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA_test_secret_key", // secret-scan: allow deterministic fixture
};

function stubLaunchEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
}

describe("getLaunchHealthSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubLaunchEnv(VALID_PRODUCTION_ENV);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ok when config, Supabase, and audit checks are healthy", async () => {
    const resolvedOk = Promise.resolve({ error: null });
    vi.mocked(createAdminClient).mockImplementation(() => {
      // mock called
      return {
        from: (_table: string) => {
          // from() called
          return { select: () => ({ limit: () => resolvedOk }) };
        },
      } as never;
    });
    vi.mocked(getAuditFailureCount).mockReturnValue(0);

    const snapshot = await getLaunchHealthSnapshot();

    expect(snapshot.checks.config.status).toBe("ok");
    expect(snapshot.checks.supabase.status).toBe("ok");
    expect(snapshot.checks.schema.status).toBe("ok");
    expect(snapshot.checks.audit.status).toBe("ok");
    expect(snapshot.status).toBe("ok");
  });

  it("returns degraded when schema probe fails in production", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "feature_flags") {
          return {
            select: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ error: { message: "relation does not exist" } }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }),
    } as never);
    vi.mocked(getAuditFailureCount).mockReturnValue(0);

    const snapshot = await getLaunchHealthSnapshot();

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.checks.schema.status).toBe("degraded");
  });

  it("returns degraded when production config drifts from launch requirements", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    } as never);
    vi.mocked(getAuditFailureCount).mockReturnValue(0);

    const snapshot = await getLaunchHealthSnapshot();

    expect(snapshot.status).toBe("degraded");
    expect(snapshot.checks.config.status).toBe("degraded");
    expect(snapshot.checks.config.failedChecks).toContain("App URL");
  });

  it("skips the Supabase probe in e2e mode", async () => {
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("AFRICASTALKING_USERNAME", "sandbox");
    vi.stubEnv("OZOW_ENV", "staging");
    vi.mocked(getAuditFailureCount).mockReturnValue(0);

    const snapshot = await getLaunchHealthSnapshot();

    expect(snapshot.status).toBe("ok");
    expect(snapshot.mode).toBe("e2e");
    expect(snapshot.checks.supabase.status).toBe("skipped");
    expect(snapshot.checks.schema.status).toBe("skipped");
  });
});

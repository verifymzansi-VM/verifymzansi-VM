import { test, expect } from "@playwright/test";

/**
 * E2E KYC Verification Tests
 *
 * These tests cover the main KYC flows via the browser and API.
 * They require a running app (dev server) and mock-friendly Supabase.
 */
const TRANSIENT_NETWORK_ERROR_PATTERN = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i;

function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_NETWORK_ERROR_PATTERN.test(message);
}

async function withTransientNetworkRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 2
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isTransientNetworkError(error);
      if (!shouldRetry) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Unknown network error"));
}

test.describe("KYC Verification Flows", () => {
  test.describe("Unauthenticated access", () => {
    test("verification page redirects to login", async ({ page }) => {
      await page.goto("/verification");
      await page.waitForURL(/\/login/);
      expect(page.url()).toContain("/login");
    });

    test("verification API returns 401 without auth", async ({ request }) => {
      const response = await withTransientNetworkRetry(() =>
        request.post("/api/verification/session/start", {
          data: {},
        })
      );
      expect(response.status()).toBe(401);
    });

    test("admin evidence desk requires auth", async ({ page }) => {
      await page.goto("/admin/verification/evidence");
      // Should redirect to login or show unauthorized
      await page.waitForURL(/\/login|\/admin/);
    });
  });

  test.describe("Session API", () => {
    test("session start returns 401 without auth cookie", async ({ request }) => {
      const res = await withTransientNetworkRetry(() =>
        request.post("/api/verification/session/start")
      );
      expect(res.status()).toBe(401);
    });

    test("upload endpoint returns 401 without auth", async ({ request }) => {
      const res = await withTransientNetworkRetry(() => request.post("/api/verification/upload"));
      expect(res.status()).toBe(401);
    });

    test("GPS endpoint returns 401 without auth", async ({ request }) => {
      const res = await withTransientNetworkRetry(() =>
        request.post("/api/verification/location/gps", {
          data: { latitude: -26.2, longitude: 28.0 },
        })
      );
      expect(res.status()).toBe(401);
    });

    test("manual location endpoint returns 401 without auth", async ({ request }) => {
      const res = await withTransientNetworkRetry(() =>
        request.post("/api/verification/location/manual", {
          data: { province: "Gauteng", city: "Johannesburg" },
        })
      );
      expect(res.status()).toBe(401);
    });
  });

  test.describe("Admin endpoints", () => {
    test("decide endpoint returns 401 without auth", async ({ request }) => {
      const res = await withTransientNetworkRetry(() =>
        request.post("/api/admin/verification/decide", {
          data: { stepId: "test", decision: "approved" },
        })
      );
      expect(res.status()).toBe(401);
    });

    test("evidence endpoint returns 401 without auth", async ({ request }) => {
      const res = await withTransientNetworkRetry(() =>
        request.get("/api/admin/verification/evidence?artifactId=test")
      );
      expect(res.status()).toBe(401);
    });
  });

  test.describe("Webhook endpoint", () => {
    test("webhook rejects empty payload", async ({ request }) => {
      const res = await withTransientNetworkRetry(() =>
        request.post("/api/webhooks/kyc/provider", {
          data: {},
        })
      );
      expect(res.status()).toBe(400);
    });

    test("webhook accepts unknown provider_ref gracefully", async ({ request }) => {
      const res = await withTransientNetworkRetry(() =>
        request.post("/api/webhooks/kyc/provider", {
          data: {
            provider_ref: "unknown-test-ref-" + Date.now(),
            status: "approved",
          },
        })
      );
      // Should return 200 (acknowledged) to prevent retries
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.acknowledged).toBe(true);
    });
  });
});

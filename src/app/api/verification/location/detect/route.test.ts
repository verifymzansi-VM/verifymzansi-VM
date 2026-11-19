/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FoundationSessionError } from "@/lib/foundation/request-api";

const { rpc, authenticateCaller, sharedLimit, localLimit, adminClient, serverClient } = vi.hoisted(
  () => ({
    rpc: vi.fn(),
    authenticateCaller: vi.fn(),
    sharedLimit: vi.fn(),
    localLimit: vi.fn(),
    adminClient: vi.fn(),
    serverClient: vi.fn(),
  })
);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(() => ({})),
}));
vi.mock("@/lib/foundation/request-route", () => ({
  createFoundationRouteContext: vi.fn(() => ({
    authenticateCaller,
    authenticate: vi.fn(),
    respond: async (response: Response) => response,
  })),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: sharedLimit,
  checkLocalRateLimit: localLimit,
  getClientRateLimitIdentity: () => ({ key: "client" }),
}));
vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: vi.fn(),
  securityContext: () => ({}),
}));
// The retired backend must not be reached.
vi.mock("@/lib/supabase/server", () => ({ createClient: serverClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClient }));
// Outside the Worker there is no Cloudflare context to fall back to.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => {
    throw new Error("not on Cloudflare");
  }),
}));

import { POST } from "./route";

const ACCOUNT = "5f0c2b1e-7a3d-4c8e-9b6f-1d2e3f4a5b6c";
const scope = globalThis as Record<PropertyKey, unknown>;
const CF_CONTEXT = Symbol.for("__cloudflare-context__");
const accountContext = {
  version: 1,
  account_id: ACCOUNT,
  email: "member@example.test",
  phone: null,
  profile: {
    display_name: "Thando Dlamini",
    public_name: "Thando D.",
    bio: null,
    avatar_object_id: null,
    legal_first_name: null,
    legal_last_name: null,
    legal_name_locked: false,
    identity_verified: false,
    revision: 1,
    updated_at: "2026-11-19T08:00:00Z",
  },
  totp_enrolled: false,
  staff: null,
};

/** The Cloudflare request data the Worker sees for this request. */
function withCf(cf: Record<string, string> | undefined) {
  if (cf === undefined) delete scope[CF_CONTEXT];
  else scope[CF_CONTEXT] = { cf };
}

function request(withCsrf = true) {
  const token = "a".repeat(64);
  return new NextRequest("http://localhost/api/verification/location/detect", {
    method: "POST",
    headers: withCsrf ? { cookie: `vm_csrf=${token}`, "x-csrf-token": token } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sharedLimit.mockResolvedValue({ limited: false });
  localLimit.mockReturnValue({ limited: false });
  authenticateCaller.mockResolvedValue({
    api: { rpc },
    accountId: ACCOUNT,
    sessionId: "s1",
    signedInAt: null,
  });
  rpc.mockResolvedValue({ data: accountContext, error: null });
});
afterEach(() => withCf(undefined));

describe("location detection from the Cloudflare request data", () => {
  it.each([
    [
      { country: "ZA", regionCode: "GP", region: "Gauteng", city: "Johannesburg" },
      "Gauteng",
      "Johannesburg",
    ],
    [
      { country: "ZA", regionCode: "EC", region: "Eastern Cape", city: "Gqeberha" },
      "Eastern Cape",
      "Port Elizabeth (Gqeberha)",
    ],
    [{ country: "ZA", region: "KwaZulu-Natal", city: "Durban" }, "KwaZulu-Natal", "Durban"],
    [{ country: "ZA", regionCode: "WC", city: "Cape Town" }, "Western Cape", "Cape Town"],
  ])("suggests a listed province and city: %j", async (cf, province, city) => {
    withCf(cf);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ detected: true, province, city });
    expect(localLimit).toHaveBeenCalledWith(ACCOUNT, "verification:location-detect", 10);
    expect(sharedLimit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "verification:location-detect", degradedMode: "block" })
    );
    // Only the account check reaches the database; nothing is saved.
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_account_context", {}, { get: false });
    expect(serverClient).not.toHaveBeenCalled();
    expect(adminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["no Cloudflare data", undefined],
    ["empty Cloudflare data", {}],
    ["outside South Africa", { country: "US", region: "Gauteng", city: "Johannesburg" }],
    ["an unknown region", { country: "ZA", regionCode: "XX", city: "Johannesburg" }],
    ["a city in another province", { country: "ZA", regionCode: "GP", city: "Cape Town" }],
    ["an unlisted city", { country: "ZA", regionCode: "GP", city: "Atlantis" }],
    ["no city", { country: "ZA", regionCode: "GP" }],
  ])("answers that it detected nothing for %s", async (_label, cf) => {
    withCf(cf);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ detected: false, province: null, city: null });
  });

  it("answers that it detected nothing when the request data cannot be read", async () => {
    Object.defineProperty(scope, CF_CONTEXT, {
      configurable: true,
      get() {
        throw new Error("unreadable");
      },
    });
    try {
      const response = await POST(request());
      expect(await response.json()).toEqual({ detected: false, province: null, city: null });
    } finally {
      delete scope[CF_CONTEXT];
    }
  });
});

describe("location detection protections", () => {
  it("requires the CSRF token before anything else", async () => {
    withCf({ country: "ZA", regionCode: "GP", city: "Johannesburg" });
    expect((await POST(request(false))).status).toBe(403);
    expect(authenticateCaller).not.toHaveBeenCalled();
    expect(sharedLimit).not.toHaveBeenCalled();
  });

  it("requires a signed-in member", async () => {
    authenticateCaller.mockRejectedValue(new FoundationSessionError(401));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to manage verification" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an account without access (for example an unconfirmed email)", async () => {
    withCf({ country: "ZA", regionCode: "GP", city: "Johannesburg" });
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "account_access_unavailable" });
  });

  it("has a separate per-account detection cap with retry guidance", async () => {
    localLimit.mockReturnValue({ limited: true, retryAfter: 30 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toMatchObject({ reason: "location_detection_limited" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops at the shared per-client limit", async () => {
    sharedLimit.mockResolvedValue({ limited: true, retryAfter: 45 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(authenticateCaller).not.toHaveBeenCalled();
  });
});

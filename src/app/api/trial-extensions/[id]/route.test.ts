import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as HiddenFeatures from "@/lib/hidden-features";
// The route is hidden until it works (src/lib/hidden-features.ts); these
// tests switch it on to keep the code behind the switch checked.
const hiddenFeature = vi.hoisted(() => ({ shown: true }));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  get SHOW_TRIAL_EXTENSION_OFFERS() {
    return hiddenFeature.shown;
  },
}));

const OFFER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const { mockCreateClient, mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkLocalRateLimit: () => ({ limited: false }) }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "./route";

const rpc = vi.fn();
const context = { params: Promise.resolve({ id: OFFER_ID }) };
const request = (body: unknown) =>
  new Request(`https://verifymzansi.com/api/trial-extensions/${OFFER_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function signedIn(user: { id: string } | null) {
  mockCreateClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) } });
}

describe("POST /api/trial-extensions/:id while hidden", () => {
  it("answers 404 before any other check", async () => {
    hiddenFeature.shown = false;
    try {
      const res = await POST(
        new Request("https://verifymzansi.com/api/trial-extensions/x", {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) }
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    } finally {
      hiddenFeature.shown = true;
    }
  });
});

describe("POST /api/trial-extensions/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ rpc });
  });

  it("requires a signed-in member", async () => {
    signedIn(null);
    expect((await POST(request({ decision: "accept" }), context)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers as the signed-in member, never as a user named in the body", async () => {
    signedIn({ id: USER_ID });
    rpc.mockResolvedValue({ data: { status: "accepted" }, error: null });
    const res = await POST(request({ decision: "accept", userId: "someone-else" }), context);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("respond_trial_extension", {
      p_user: USER_ID,
      p_offer: OFFER_ID,
      p_accept: true,
    });
  });

  it("explains a second answer and an expired offer in plain language", async () => {
    signedIn({ id: USER_ID });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TRIAL_EXTENSION_ANSWERED: already answered", code: "P0001" },
    });
    const answered = await POST(request({ decision: "decline" }), context);
    expect(answered.status).toBe(409);
    expect((await answered.json()).error).toMatch(/already been answered/);

    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "TRIAL_EXTENSION_EXPIRED: expired", code: "P0001" },
    });
    const expired = await POST(request({ decision: "accept" }), context);
    expect(expired.status).toBe(410);
  });

  it("rejects anything but accept or decline", async () => {
    signedIn({ id: USER_ID });
    expect((await POST(request({ decision: "extend" }), context)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

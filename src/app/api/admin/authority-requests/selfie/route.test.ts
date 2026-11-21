/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "./route";
import {
  AuthorityRequestRefused,
  readIdentityDisclosureSelfie,
} from "@/lib/foundation/identity-disclosures";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";

const { authenticateCaller, checkRateLimit } = vi.hoisted(() => ({
  authenticateCaller: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: vi.fn(() => null) }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(() => ({})),
}));
vi.mock("@/lib/foundation/request-route", () => ({
  createFoundationRouteContext: vi.fn(() => ({
    authenticateCaller,
    respond: (response: NextResponse) => response,
  })),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn(() => ({})) }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/foundation/identity-disclosures", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readIdentityDisclosureSelfie: vi.fn(),
}));

const STAFF = "00000000-0000-4000-8000-000000000002";
const DISCLOSURE = "00000000-0000-4000-8000-000000000001";
const SUBJECT = "00000000-0000-4000-8000-000000000003";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0]);
const post = (body: unknown) =>
  POST(
    new NextRequest("https://verifymzansi.com/api/admin/authority-requests/selfie", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  authenticateCaller.mockResolvedValue({ api: { rpc: vi.fn() }, accountId: STAFF });
  checkRateLimit.mockResolvedValue({ limited: false, degraded: false });
});

describe("/api/admin/authority-requests/selfie", () => {
  it("refuses GET: identifiers stay out of query strings", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("serves the selfie to the staff member who opened the record, never cached", async () => {
    vi.mocked(readIdentityDisclosureSelfie).mockResolvedValue(jpeg);
    const response = await post({ disclosureId: DISCLOSURE, subject: SUBJECT });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-verifymzansi-actor")).toBe(STAFF);
    expect(readIdentityDisclosureSelfie).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      STAFF,
      DISCLOSURE,
      SUBJECT
    );
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: STAFF, action: "admin:evidence:view" })
    );
  });

  it("answers 404 when no selfie is kept, 410 once the record closed", async () => {
    vi.mocked(readIdentityDisclosureSelfie).mockResolvedValueOnce(null);
    expect((await post({ disclosureId: DISCLOSURE, subject: SUBJECT })).status).toBe(404);
    vi.mocked(readIdentityDisclosureSelfie).mockRejectedValueOnce(
      new AuthorityRequestRefused(410, "disclosure_closed")
    );
    const closed = await post({ disclosureId: DISCLOSURE, subject: SUBJECT });
    expect(closed.status).toBe(410);
    expect(await closed.json()).toMatchObject({ reason: "disclosure_closed" });
  });

  it("sends staff with an old code to confirm it", async () => {
    vi.mocked(readIdentityDisclosureSelfie).mockRejectedValueOnce(
      new FoundationStaffCommandError(403, "Verify again", true)
    );
    const response = await post({ disclosureId: DISCLOSURE, subject: SUBJECT });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "step_up_required" });
  });

  it("refuses malformed bodies and rate-limited callers without reading", async () => {
    expect((await post({ disclosureId: DISCLOSURE })).status).toBe(422);
    checkRateLimit.mockResolvedValueOnce({ limited: true, degraded: false });
    expect((await post({ disclosureId: DISCLOSURE, subject: SUBJECT })).status).toBe(429);
    expect(readIdentityDisclosureSelfie).not.toHaveBeenCalled();
  });
});

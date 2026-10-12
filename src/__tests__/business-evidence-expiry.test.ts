// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), download: vi.fn() }));
vi.mock("@/app/api/admin/verification/_lib/evidence-route-auth", () => ({
  authorizeEvidenceRequest: mocks.auth,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/services/storage", () => ({ downloadKycDocument: mocks.download }));
vi.mock("@/lib/utils/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
import { GET } from "@/app/api/admin/business-verification/files/[fileId]/route";
const id = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-11T12:00:00Z");
let file: Record<string, unknown>;
let insert: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  vi.stubEnv("IP_HASH_SECRET", "synthetic-only-evidence-hash-secret");
  mocks.auth.mockResolvedValue({ success: true, user: { id: "staff" }, role: "admin" });
  mocks.download.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]));
  file = {
    id,
    case_id: id,
    r2_key: "synthetic/evidence.bin",
    quarantined: false,
    extracted_text: "synthetic private text",
    purged_at: null,
    purge_after: null,
    business_verifications: { owner_id: "owner", business_id: id },
  };
  insert = vi.fn().mockResolvedValue({ error: null });
  mocks.admin.mockReturnValue({
    from: (table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({
          data: table === "business_verification_files" ? file : { owner_id: "owner" },
          error: null,
        })),
        insert,
      };
      return query;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const call = () =>
  GET({ headers: new Headers() } as NextRequest, { params: Promise.resolve({ fileId: id }) });
describe("business evidence expiry before text or byte delivery", () => {
  for (const quarantined of [false, true]) {
    it.each(["2026-10-10T12:00:00Z", now.toISOString(), "invalid", ""])(
      `denies deadline %s (quarantined=${quarantined})`,
      async (deadline) => {
        Object.assign(file, { quarantined, purge_after: deadline });
        const response = await call();
        expect(response.status).toBe(410);
        expect(await response.text()).not.toContain("synthetic private text");
        expect(mocks.download).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      }
    );
    it.each([null, "2026-10-12T12:00:00Z"])(
      `serves authorized unexpired evidence %s (quarantined=${quarantined})`,
      async (deadline) => {
        Object.assign(file, { quarantined, purge_after: deadline });
        const response = await call();
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(insert).toHaveBeenCalledOnce();
        expect(mocks.download).toHaveBeenCalledTimes(quarantined ? 0 : 1);
      }
    );
  }
  it("still rejects purged files", async () => {
    file.purged_at = now.toISOString();
    expect((await call()).status).toBe(410);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("does not deliver when audit logging fails", async () => {
    insert.mockResolvedValue({ error: { message: "synthetic failure" } });
    expect((await call()).status).toBe(503);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("retains the self-review boundary", async () => {
    mocks.auth.mockResolvedValue({ success: true, user: { id: "owner" }, role: "admin" });
    expect((await call()).status).toBe(403);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});

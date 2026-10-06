// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "@/lib/business-verification/test-db";

type FakeDb = ReturnType<typeof createFakeDb>;

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as FakeDb | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db!.client }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: () => null }));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: async () => ({ limited: false }) }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({
  notifyStaffForAdminEvent: vi.fn().mockResolvedValue(true),
}));
const upload = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ key: "kyc/business-cipc/owner-1/x.bin" })
);
vi.mock("@/lib/services/storage", () => ({ uploadKycDocument: upload, deleteFromR2: vi.fn() }));

import { POST } from "./route";

const OWNER = "owner-1";
const BIZ = "11111111-1111-4111-8111-111111111111";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);

function seed(verification = "verified") {
  state.db = createFakeDb({
    businesses: [
      { id: BIZ, owner_id: OWNER, business_name: "Example Kitchen", cipc_verified_at: null },
    ],
    account_profiles: [
      { user_id: OWNER, account_verification_status: verification, account_status: "active" },
    ],
    verification_steps: [],
    business_verifications: [],
    business_verification_files: [],
  });
}

function request(fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(`https://verifymzansi.com/api/businesses/${BIZ}/verification/cipc`, {
    method: "POST",
    body: form,
  });
}

const params = Promise.resolve({ id: BIZ });
const photo = () => new File([JPEG], "cert.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: OWNER };
  seed();
});

describe("POST /api/businesses/[id]/verification/cipc", () => {
  it("requires sign-in", async () => {
    state.user = null;
    const res = await POST(request({ file: photo() }) as never, { params });
    expect(res.status).toBe(401);
  });

  it("hides businesses the caller does not own", async () => {
    state.user = { id: "someone-else" };
    const res = await POST(request({ file: photo() }) as never, { params });
    expect(res.status).toBe(404);
  });

  it("needs the ID Reviewed sticker first", async () => {
    seed("pending_review");
    const res = await POST(request({ file: photo() }) as never, { params });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "id_review_required" });
  });

  it("asks for the number when the document can't be read", async () => {
    const res = await POST(request({ file: photo() }) as never, { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "registration_number_required" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects files that aren't PDFs or photos as an upload error", async () => {
    const res = await POST(
      request({
        file: new File(["hello"], "a.txt", { type: "text/plain" }),
        registrationNumber: "2020/123456/07",
      }) as never,
      { params }
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "unsupported_file" });
  });

  it("stores the photo encrypted and opens a case with findings, never a decision", async () => {
    const res = await POST(
      request({
        file: photo(),
        registrationNumber: "2020-123456-07",
        route: "representative",
      }) as never,
      { params }
    );
    expect(res.status).toBe(201);
    expect(upload).toHaveBeenCalledOnce();
    const [created] = state.db!.tables.business_verifications;
    // Status defaults to "pending" in the database; the route never sets a decision.
    expect(created).toMatchObject({
      kind: "cipc",
      route: "representative",
      registration_number: "2020/123456/07",
    });
    expect(created).not.toHaveProperty("status");
    expect((created.findings as Array<{ code: string }>).map((f) => f.code)).toContain(
      "no_text_layer"
    );
    expect(state.db!.tables.business_verification_files[0]).toMatchObject({
      kind: "owner_upload",
      content_type: "image/jpeg",
      quarantined: false,
    });
  });
});

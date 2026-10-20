import * as service from "@/lib/business-verification/service";
import { deleteFromR2 } from "@/lib/services/storage";
import { notifyStaffForAdminEvent } from "@/lib/notifications";
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
  createNotification: vi.fn().mockResolvedValue(true),
  notifyStaffForAdminEvent: vi.fn().mockResolvedValue(true),
}));
const upload = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ key: "kyc/business-message/owner-1/x.bin" })
);
vi.mock("@/lib/services/storage", () => ({ uploadKycDocument: upload, deleteFromR2: vi.fn() }));

import { POST } from "./route";

const OWNER = "owner-1";
const BIZ = "11111111-1111-4111-8111-111111111111";
const CASE = "33333333-3333-4333-8333-333333333333";
const CIPC_OFFICE = { city: "Empangeni", province: "KwaZulu-Natal", streetLines: ["12 MAIN ROAD"] };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);

/** A valid one-page PDF with no text layer. */
function scannedPdfBytes(): Uint8Array<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

function seed(kind: "cipc" | "seen", caseOverrides: Record<string, unknown> = {}) {
  state.db = createFakeDb({
    businesses: [
      { id: BIZ, owner_id: OWNER, business_name: "Example Kitchen", cipc_verified_at: null },
    ],
    account_profiles: [
      { user_id: OWNER, account_verification_status: "verified", account_status: "active" },
    ],
    verification_steps: [],
    business_verifications: [
      {
        id: CASE,
        business_id: BIZ,
        owner_id: OWNER,
        kind,
        status: "info_requested",
        registration_number: "2020/123456/07",
        registered_office: CIPC_OFFICE,
        admin_copy: null,
        checks: null,
        updated_at: "2026-10-20T08:00:00.000Z",
        ...caseOverrides,
      },
    ],
    business_verification_files: [],
    business_verification_messages: [],
  });
}

function request(file: File) {
  const form = new FormData();
  form.set("caseId", CASE);
  form.set("file", file);
  return new Request(`https://verifymzansi.com/api/businesses/${BIZ}/verification/messages`, {
    method: "POST",
    body: form,
  });
}

const params = Promise.resolve({ id: BIZ });
const photo = () => new File([JPEG], "cert.jpg", { type: "image/jpeg" });
const scan = () => new File([scannedPdfBytes()], "cert.pdf", { type: "application/pdf" });
const caseRow = () => state.db!.tables.business_verifications[0];

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: OWNER };
});

describe("POST /api/businesses/[id]/verification/messages", () => {
  it("asks for the CIPC PDF when a CIPC case gets a photo", async () => {
    seed("cipc");
    const res = await POST(request(photo()) as never, { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "pdf_required" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("still takes photos on a Seen case", async () => {
    seed("seen");
    const res = await POST(request(photo()) as never, { params });
    expect(res.status).toBe(201);
  });

  it("keeps CIPC's office once staff attached their copy", async () => {
    seed("cipc", { admin_copy: { registeredOffice: CIPC_OFFICE, directors: [] } });
    const res = await POST(request(scan()) as never, { params });
    expect(res.status).toBe(201);
    expect(caseRow().registered_office).toEqual(CIPC_OFFICE);
  });

  it("keeps an office staff corrected by hand", async () => {
    seed("cipc", { checks: { officeCorrectedBy: "mod-1" } });
    const res = await POST(request(scan()) as never, { params });
    expect(res.status).toBe(201);
    expect(caseRow().registered_office).toEqual(CIPC_OFFICE);
  });

  it("takes the office from the new document before staff have a copy", async () => {
    seed("cipc");
    const res = await POST(request(scan()) as never, { params });
    expect(res.status).toBe(201);
    // A scan has no readable office, so the new document's (empty) office wins.
    expect(caseRow().registered_office).toBeNull();
  });
  it("preserves a staff office correction committed during an owner upload", async () => {
    seed("cipc");
    upload.mockImplementationOnce(async () => {
      caseRow().admin_copy = { registeredOffice: CIPC_OFFICE, directors: [] };
      caseRow().checks = { officeCorrectedBy: "mod-1" };
      caseRow().updated_at = "2026-10-20T08:01:00.000Z";
      return { key: "kyc/business-message/owner-1/race.bin" };
    });
    const res = await POST(request(scan()) as never, { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "case_changed" });
    expect(caseRow().registered_office).toEqual(CIPC_OFFICE);
    expect(caseRow().checks).toEqual({ officeCorrectedBy: "mod-1" });
    expect(caseRow().updated_at).toBe("2026-10-20T08:01:00.000Z");
    expect(state.db!.tables.business_verification_messages).toHaveLength(0);
    expect(state.db!.tables.business_verification_files).toHaveLength(0);
  });
  it("discards the upload and journal row if screening fails before the case update", async () => {
    seed("cipc");
    vi.spyOn(service, "screenUpload").mockRejectedValueOnce(
      new Error("synthetic screening failure")
    );
    const res = await POST(request(scan()) as never, { params });
    expect(res.status).toBe(500);
    expect(caseRow().status).toBe("info_requested");
    expect(state.db!.tables.business_verification_files).toHaveLength(0);
    expect(state.db!.tables.business_verification_messages).toHaveLength(0);
    expect(deleteFromR2).toHaveBeenCalledTimes(1);
    expect(notifyStaffForAdminEvent).not.toHaveBeenCalled();
  });
  it("discards unused evidence after a confirmed rolled-back case update", async () => {
    seed("seen");
    const from = state.db!.client.from;
    vi.spyOn(state.db!.client, "from").mockImplementation((table) => {
      const query = from(table);
      if (table === "business_verifications") {
        const update = query.update;
        query.update = (value) => {
          update(value);
          query.then = (resolve) =>
            Promise.resolve({
              data: null,
              error: { code: "23514", message: "synthetic constraint refusal" },
            } as never).then(resolve);
          return query;
        };
      }
      return query;
    });
    const res = await POST(request(photo()) as never, { params });
    expect(res.status).toBe(500);
    expect(state.db!.tables.business_verification_files).toHaveLength(0);
    expect(deleteFromR2).toHaveBeenCalledTimes(1);
    expect(notifyStaffForAdminEvent).not.toHaveBeenCalled();
  });
  it("preserves evidence after a committed case update if the message insert fails", async () => {
    seed("seen");
    const from = state.db!.client.from;
    vi.spyOn(state.db!.client, "from").mockImplementation((table) => {
      const query = from(table);
      if (table === "business_verification_messages")
        query.insert = () => {
          throw new Error("synthetic message failure");
        };
      return query;
    });
    const res = await POST(request(photo()) as never, { params });
    expect(res.status).toBe(500);
    expect(caseRow().status).toBe("pending");
    expect(state.db!.tables.business_verification_files).toHaveLength(1);
    expect(deleteFromR2).not.toHaveBeenCalled();
    expect(notifyStaffForAdminEvent).not.toHaveBeenCalled();
  });
  it("retains evidence when a case update has an uncertain transport outcome", async () => {
    seed("seen");
    const from = state.db!.client.from;
    vi.spyOn(state.db!.client, "from").mockImplementation((table) => {
      const query = from(table);
      if (table === "business_verifications") {
        const update = query.update;
        query.update = (value) => {
          update(value);
          query.then = (resolve) =>
            Promise.resolve({
              data: null,
              error: { code: "", message: "synthetic lost response" },
            } as never).then(resolve);
          return query;
        };
      }
      return query;
    });
    const res = await POST(request(photo()) as never, { params });
    expect(res.status).toBe(500);
    expect(state.db!.tables.business_verification_files).toHaveLength(1);
    expect(deleteFromR2).not.toHaveBeenCalled();
    expect(notifyStaffForAdminEvent).not.toHaveBeenCalled();
  });
});

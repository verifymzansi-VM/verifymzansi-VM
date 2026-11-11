import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStaffCipcCase } from "./business-cipc";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [caseId, owner, business, staff, fileId] = [1, 2, 3, 4, 5].map(uuid);
const at = "2026-11-01T10:00:00Z";
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const director = (name: string, role: string | null, isOwner = false) => ({
  name,
  role,
  hasSaId: true,
  isOwner,
});
const summary = (over = {}) => ({
  registrationNumber: "2020/123456/07",
  registeredName: "Example Trading (Pty) Ltd",
  enterpriseStatus: "In Business",
  issuedOn: "2026-10-01",
  docType: "registration_certificate",
  registeredOfficeLines: ["1 Main Road", "Durban"],
  registeredOffice: null,
  directors: [director("Thandi Example", "Director", true), director("Sipho Example", "Director")],
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  id: caseId,
  ownerId: owner,
  kind: "cipc",
  route: "director",
  status: "pending",
  registrationNumber: "2020/123456/07",
  createdAt: at,
  updatedAt: at,
  decidedAt: null,
  expiresAt: null,
  reasonCode: null,
  reviewNote: null,
  business: {
    id: business,
    business_name: "Example",
    slug: "example",
    status: "active",
    location_city: null,
    location_province: null,
  },
  owner: { displayName: "Thandi", legalName: "Thandi Example", idReviewed: true },
  parsed: summary(),
  official: null,
  office: null,
  representative: null,
  exception: null,
  evidence: {
    ready: true,
    missing: [],
    unwaivable: [],
    role: "director",
    position: null,
    registeredName: "Example Trading (Pty) Ltd",
  },
  files: [
    {
      id: fileId,
      kind: "owner_upload",
      content_type: "application/pdf",
      size_bytes: 1000,
      created_at: at,
      quarantined: false,
      purged_at: null,
    },
  ],
  messages: [],
  accessLog: [],
  ...over,
});
const answer = (data: unknown) => rpc.mockResolvedValue({ data, error: null });

beforeEach(() => rpc.mockReset());

describe("readStaffCipcCase", () => {
  it("returns null for a case the database does not show", async () => {
    answer(null);
    expect(await readStaffCipcCase(api, caseId)).toBeNull();
    expect(rpc).toHaveBeenCalledWith("get_frontend_cipc_case", { p_case: caseId }, { get: false });
  });

  it("adapts a pending case without an official copy to the restored detail shape", async () => {
    answer(detail());
    const result = await readStaffCipcCase(api, caseId);
    expect(result).toMatchObject({
      docType: "registration_certificate",
      business: { cipc_verified_at: null, cipc_registration_number: null },
      owner: { hasIdHash: true },
      ownerMatchOnUpload: "Thandi Example",
      adminCopy: null,
      checks: null,
      findings: [],
      suggestion: { action: "review", text: expect.stringContaining("attach your copy") },
      files: [{ id: fileId, producer: null, revision_count: null }],
    });
  });

  it("exposes the verified registration only once the case is approved", async () => {
    answer(detail({ status: "approved", decidedAt: at }));
    expect((await readStaffCipcCase(api, caseId))?.business).toMatchObject({
      cipc_verified_at: at,
      cipc_registration_number: "2020/123456/07",
    });
  });

  it.each([
    ["the registration number", { registrationNumber: "2019/000001/07" }, "attention"],
    ["the status", { enterpriseStatus: "Deregistered" }, "attention"],
    ["the registered office", { registeredOfficeLines: ["9 Other Street"] }, "check"],
    ["the directors", { directors: [director("Thandi Example", "Director")] }, "check"],
  ])("flags a difference in %s from the official copy", async (_n, change, severity) => {
    answer(detail({ official: summary(change) }));
    const result = await readStaffCipcCase(api, caseId);
    expect(result?.findings).toEqual([
      expect.objectContaining({ code: "official_copy_difference", severity }),
    ]);
    expect(result?.suggestion.action).toBe(severity === "attention" ? "review" : "approve");
  });

  it("matches directors regardless of case and spacing", async () => {
    const official = summary({
      directors: [
        director(" thandi example ", "DIRECTOR"),
        director("SIPHO EXAMPLE", " director "),
      ],
    });
    answer(
      detail({
        official: { ...official, cipcReference: "REF-1", registeredOffice: { city: "Durban" } },
      })
    );
    const result = await readStaffCipcCase(api, caseId);
    expect(result?.findings).toEqual([]);
    expect(result?.suggestion.action).toBe("approve");
    expect(result?.adminCopy).toMatchObject({
      cipcReference: "REF-1",
      registeredOffice: { streetLines: [], suburb: null, city: "Durban", cityKnown: false },
    });
  });

  it("only names an exception's confirmer when there is one", async () => {
    answer(detail({ exception: { proposedBy: staff, confirmedBy: null, reason: "Trust deed" } }));
    expect((await readStaffCipcCase(api, caseId))?.checks).toEqual({
      exception: { proposedBy: staff, reason: "Trust deed" },
    });
  });

  it.each([
    ["another case's detail", { id: uuid(9) }],
    ["an unexpected top-level field", { ownerIdNumber: "8001015009087" }],
    [
      "an unexpected owner field",
      { owner: { displayName: null, legalName: null, idReviewed: true, idHash: "x" } },
    ],
    ["a quarantined file", { files: [{ ...detail().files[0], quarantined: true }] }],
    ["a non-PDF file", { files: [{ ...detail().files[0], content_type: "text/html" }] }],
    ["a malformed registration number", { registrationNumber: "2020-123456-07" }],
    ["an unknown status", { status: "deleted" }],
    [
      "an unbounded message list",
      {
        messages: Array.from({ length: 101 }, () => ({
          id: fileId,
          author_id: null,
          author_role: "owner",
          body: "x",
          created_at: at,
          attachment_file_id: null,
        })),
      },
    ],
  ])("refuses %s", async (_n, change) => {
    answer(detail(change));
    await expect(readStaffCipcCase(api, caseId)).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    ["42501", 403],
    ["PT409", 409],
    ["XX000", 503],
  ])("maps database error %s to %i", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code } });
    await expect(readStaffCipcCase(api, caseId)).rejects.toMatchObject({ status });
  });
});

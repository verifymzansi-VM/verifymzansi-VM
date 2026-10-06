import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/services/email", () => ({
  sendBusinessVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/services/storage", () => ({ uploadKycDocument: vi.fn(), deleteFromR2: vi.fn() }));

import type { SupabaseClient } from "@supabase/supabase-js";

import { decideBusinessVerification, type DecisionInput } from "./decide";
import { createFakeDb } from "./test-db";

const OWNER = "owner-1";
const MOD = "mod-1";
const ADMIN_A = "admin-a";
const ADMIN_B = "admin-b";
const NUMBER = "2020/123456/07";
const V1 = "2026-10-06T08:00:00.000Z";

function adminCopy(overrides: Record<string, unknown> = {}) {
  return {
    registrationNumber: NUMBER,
    registeredName: "EXAMPLE TRADING (PTY) LTD",
    enterpriseStatus: "In Business",
    directors: [{ name: "DLAMINI, THANDO", role: "Director", idHmac: "hmac-owner" }],
    registeredOffice: { suburb: "KwaDlangezwa", city: "Empangeni", province: "KwaZulu-Natal" },
    cipcReference: null,
    differences: [],
    ...overrides,
  };
}

function setup(
  caseOverrides: Record<string, unknown> = {},
  extra: Record<string, Record<string, unknown>[]> = {}
) {
  const fake = createFakeDb({
    business_verifications: [
      {
        id: "case-1",
        business_id: "biz-1",
        owner_id: OWNER,
        kind: "cipc",
        route: "director",
        status: "pending",
        registration_number: NUMBER,
        parsed: {},
        registered_office: null,
        admin_copy: null,
        representative: null,
        seen: null,
        linked_case_id: null,
        checks: null,
        updated_at: V1,
        ...caseOverrides,
      },
    ],
    businesses: [
      { id: "biz-1", owner_id: OWNER, business_name: "Example Kitchen", cipc_verified_at: null },
    ],
    verification_steps: [
      { user_id: OWNER, step_type: "id_doc", status: "approved", id_number_hmac: "hmac-owner" },
    ],
    business_verification_files: [{ id: "f1", case_id: "case-1", purge_after: null }],
    business_verification_messages: [],
    account_profiles: [{ user_id: OWNER, display_name: "Thando" }],
    ...extra,
  });
  const decide = (input: Partial<DecisionInput>) =>
    decideBusinessVerification(fake.client as unknown as SupabaseClient, {
      action: "approve",
      caseId: "case-1",
      expectedUpdatedAt: fake.tables.business_verifications[0].updated_at as string,
      actorId: MOD,
      actorRole: "moderator",
      checks: { inBusiness: true, ownerConfirmed: true },
      ...input,
    });
  return {
    fake,
    decide,
    caseRow: () => fake.tables.business_verifications[0],
    biz: () => fake.tables.businesses[0],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("decideBusinessVerification", () => {
  it("refuses approval until staff attach their own CIPC copy", async () => {
    const { decide, biz } = setup();
    const result = await decide({});
    expect(result).toMatchObject({ ok: false, code: "evidence_missing" });
    expect(biz().cipc_verified_at).toBeNull();
  });

  it("requires the reviewer to tick what they confirmed", async () => {
    const { decide } = setup({ admin_copy: adminCopy() });
    expect(await decide({ checks: { inBusiness: true } })).toMatchObject({
      code: "checks_required",
    });
  });

  it("approves from the admin copy and grants the sticker with the owner's role", async () => {
    const { fake, decide, caseRow, biz } = setup({ admin_copy: adminCopy() });
    expect(await decide({})).toEqual({ ok: true, status: "approved" });
    expect(caseRow()).toMatchObject({ status: "approved", reviewed_by: MOD });
    expect(biz()).toMatchObject({
      cipc_registration_number: NUMBER,
      cipc_registered_name: "EXAMPLE TRADING (PTY) LTD",
      owner_verified_role: "director",
      owner_position_title: "Director",
      cipc_registered_office: adminCopy().registeredOffice,
    });
    expect(biz().cipc_expires_at).toBeTruthy();
    expect(fake.tables.business_verification_files[0].purge_after).toBeTruthy();
  });

  it("refuses when the owner's ID is not on the CIPC copy", async () => {
    const { decide } = setup({
      admin_copy: adminCopy({
        directors: [{ name: "OTHER, PERSON", role: "Director", idHmac: "x" }],
      }),
    });
    const result = await decide({});
    expect(result).toMatchObject({ ok: false, code: "evidence_missing" });
    expect(!result.ok && result.error).toMatch(/director list/);
  });

  it("refuses when CIPC shows the company is not In Business", async () => {
    const { decide } = setup({ admin_copy: adminCopy({ enterpriseStatus: "Deregistered" }) });
    expect(await decide({})).toMatchObject({ code: "evidence_missing" });
  });

  it("refuses when another owner already holds the company's sticker", async () => {
    const { decide } = setup(
      { admin_copy: adminCopy() },
      {
        businesses: [
          {
            id: "biz-1",
            owner_id: OWNER,
            business_name: "Example Kitchen",
            cipc_verified_at: null,
          },
          {
            id: "biz-9",
            owner_id: "someone",
            cipc_registration_number: NUMBER,
            cipc_verified_at: V1,
          },
        ],
      }
    );
    const result = await decide({});
    expect(!result.ok && result.error).toMatch(/Another owner/);
  });

  it("refuses stale reviews and self-review", async () => {
    const { decide } = setup({ admin_copy: adminCopy() });
    expect(await decide({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z" })).toMatchObject({
      status: 409,
      code: "case_changed",
    });
    expect(await decide({ actorId: OWNER })).toMatchObject({
      status: 403,
      code: "not_independent",
    });
  });

  it("needs a representative to be confirmed before approval", async () => {
    const { decide } = setup({ route: "representative", admin_copy: adminCopy({ directors: [] }) });
    expect(await decide({})).toMatchObject({ code: "evidence_missing" });
  });

  it("asks the owner for information with a message and pauses the case", async () => {
    const { fake, decide, caseRow } = setup();
    expect(await decide({ action: "request_info" })).toMatchObject({ code: "note_required" });
    expect(
      await decide({ action: "request_info", note: "Please send the disclosure PDF." })
    ).toEqual({
      ok: true,
      status: "info_requested",
    });
    expect(caseRow().status).toBe("info_requested");
    expect(fake.tables.business_verification_messages).toHaveLength(1);
  });

  it("rejects only with a reason and note", async () => {
    const { decide, caseRow } = setup();
    expect(await decide({ action: "reject", note: "x" })).toMatchObject({
      code: "reason_required",
    });
    expect(
      await decide({ action: "reject", reasonCode: "unreadable", note: "Send the PDF." })
    ).toMatchObject({
      ok: true,
    });
    expect(caseRow()).toMatchObject({ status: "rejected", reason_code: "unreadable" });
  });

  it("never lets an exception skip the admin's own CIPC copy", async () => {
    const { decide } = setup();
    expect(
      await decide({ action: "propose_exception", note: "Director recently appointed." })
    ).toMatchObject({ code: "admin_copy_required" });
  });

  it("needs a second, senior reviewer for an exception", async () => {
    // The owner isn't on the director list yet, so a normal approval fails.
    const { fake, decide, biz } = setup({ admin_copy: adminCopy({ directors: [] }) });
    const version = () => fake.tables.business_verifications[0].updated_at as string;
    expect(
      await decide({
        action: "propose_exception",
        note: "Director recently appointed; CIPC lagging.",
      })
    ).toMatchObject({ ok: true, status: "pending" });
    expect(
      await decide({ action: "confirm_exception", actorId: MOD, expectedUpdatedAt: version() })
    ).toMatchObject({ code: "forbidden" });
    await decide({
      action: "propose_exception",
      note: "Another try at proposing.",
      expectedUpdatedAt: version(),
    });
    expect(
      await decide({
        action: "confirm_exception",
        actorId: ADMIN_A,
        actorRole: "admin",
        expectedUpdatedAt: version(),
      })
    ).toEqual({ ok: true, status: "approved" });
    expect(biz().cipc_verified_at).toBeTruthy();
  });

  it("stops the proposer confirming their own exception", async () => {
    const { fake, decide } = setup({ admin_copy: adminCopy({ directors: [] }) });
    await decide({
      action: "propose_exception",
      actorId: ADMIN_A,
      actorRole: "admin",
      note: "Lagging CIPC record.",
    });
    const result = await decide({
      action: "confirm_exception",
      actorId: ADMIN_A,
      actorRole: "admin",
      expectedUpdatedAt: fake.tables.business_verifications[0].updated_at as string,
    });
    expect(result).toMatchObject({ code: "not_independent" });
  });

  it("lets only senior staff remove a sticker, clearing the business", async () => {
    const { fake, decide, biz } = setup({ admin_copy: adminCopy() });
    await decide({});
    const version = () => fake.tables.business_verifications[0].updated_at as string;
    expect(
      await decide({
        action: "revoke",
        reasonCode: "other",
        note: "Deregistered.",
        expectedUpdatedAt: version(),
      })
    ).toMatchObject({ code: "forbidden" });
    expect(
      await decide({
        action: "revoke",
        actorId: ADMIN_B,
        actorRole: "admin",
        reasonCode: "not_in_business",
        note: "Deregistered.",
        expectedUpdatedAt: version(),
      })
    ).toEqual({ ok: true, status: "revoked" });
    expect(biz()).toMatchObject({ cipc_verified_at: null, owner_verified_role: null });
  });

  it("approves a linked profile only while the source sticker is live", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { decide, biz } = setup(
      { kind: "cipc_link", linked_case_id: "case-src", route: null },
      {
        businesses: [
          { id: "biz-1", owner_id: OWNER, business_name: "Branch", cipc_verified_at: null },
          {
            id: "biz-src",
            owner_id: OWNER,
            cipc_verified_at: V1,
            cipc_expires_at: future,
            cipc_registered_name: "EXAMPLE TRADING (PTY) LTD",
            cipc_registered_office: { city: "Empangeni" },
            owner_verified_role: "director",
            owner_position_title: "Director",
          },
        ],
      }
    );
    // Source case is missing → refused.
    expect(await decide({ checks: undefined })).toMatchObject({ code: "evidence_missing" });
    expect(biz().cipc_verified_at).toBeNull();
  });

  it("links a second profile to the owner's live verified company", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { fake, decide, biz } = setup(
      { kind: "cipc_link", linked_case_id: "case-src", route: null },
      {
        businesses: [
          { id: "biz-1", owner_id: OWNER, business_name: "Branch", cipc_verified_at: null },
          {
            id: "biz-src",
            owner_id: OWNER,
            cipc_verified_at: V1,
            cipc_expires_at: future,
            cipc_registered_name: "EXAMPLE TRADING (PTY) LTD",
            cipc_registered_office: { city: "Empangeni" },
            owner_verified_role: "director",
            owner_position_title: "Director",
          },
        ],
      }
    );
    fake.tables.business_verifications.push({
      id: "case-src",
      business_id: "biz-src",
      owner_id: OWNER,
      kind: "cipc",
      status: "approved",
      registration_number: NUMBER,
      registered_office: {
        streetLines: ["12 Main Road"],
        suburb: "KwaDlangezwa",
        city: "Empangeni",
        province: "KwaZulu-Natal",
        postalCode: "3886",
      },
    });
    expect(await decide({ checks: undefined })).toEqual({ ok: true, status: "approved" });
    expect(biz()).toMatchObject({
      cipc_registration_number: NUMBER,
      cipc_expires_at: future,
      owner_verified_role: "director",
    });
    // Only the public view is stored on the business; the street stays on the case.
    expect(biz().cipc_registered_office).toEqual({
      suburb: "KwaDlangezwa",
      city: "Empangeni",
      province: "KwaZulu-Natal",
    });
  });
});

function withLinkedBranch(caseOverrides: Record<string, unknown> = {}) {
  const ctx = setup(
    { admin_copy: adminCopy(), ...caseOverrides },
    {
      businesses: [
        { id: "biz-1", owner_id: OWNER, business_name: "Example Kitchen", cipc_verified_at: null },
        {
          id: "biz-branch",
          owner_id: OWNER,
          business_name: "Example Kitchen Branch",
          cipc_verified_at: V1,
          cipc_expires_at: "2026-11-01T00:00:00.000Z",
          cipc_registration_number: NUMBER,
        },
      ],
    }
  );
  ctx.fake.tables.business_verifications.push({
    id: "case-branch",
    business_id: "biz-branch",
    owner_id: OWNER,
    kind: "cipc_link",
    status: "approved",
    registration_number: NUMBER,
    expires_at: "2026-11-01T00:00:00.000Z",
  });
  return {
    ...ctx,
    branch: () => ctx.fake.tables.businesses[1],
    branchCase: () => ctx.fake.tables.business_verifications[1],
  };
}

describe("profiles linked to a verified company", () => {
  it("carry the renewed expiry date with the source company", async () => {
    const { decide, biz, branch, branchCase } = withLinkedBranch();
    expect(await decide({})).toEqual({ ok: true, status: "approved" });
    expect(branch().cipc_expires_at).toBe(biz().cipc_expires_at);
    expect(branchCase().expires_at).toBe(biz().cipc_expires_at);
  });

  it("lose the sticker when the source company's sticker is removed", async () => {
    const { fake, decide, branch, branchCase } = withLinkedBranch();
    await decide({});
    expect(
      await decide({
        action: "revoke",
        actorId: ADMIN_B,
        actorRole: "admin",
        reasonCode: "not_in_business",
        note: "Deregistered.",
        expectedUpdatedAt: fake.tables.business_verifications[0].updated_at as string,
      })
    ).toEqual({ ok: true, status: "revoked" });
    expect(branch()).toMatchObject({ cipc_verified_at: null, cipc_registration_number: null });
    expect(branchCase()).toMatchObject({ status: "revoked", reason_code: "source_revoked" });
  });
});

describe("Seen by VerifyMzansi approvals", () => {
  const photos = (by: string) =>
    [1, 2, 3].map((n) => ({ fileId: `p${n}`, takenAt: V1, lat: null, lng: null, by }));
  const report = (by: string, overrides: Record<string, unknown> = {}) => ({
    outcome: "seen",
    identityConfirmed: true,
    signage: true,
    productsSeen: "Kitchen and stock",
    premisesType: "shop",
    notes: null,
    by,
    at: V1,
    ...overrides,
  });

  it("needs the verifier's report and a different approver", async () => {
    const { decide, biz } = setup({
      kind: "seen",
      route: null,
      registration_number: null,
      seen: { method: "visit" },
    });
    expect(await decide({ checks: undefined })).toMatchObject({ code: "evidence_missing" });

    const own = setup({
      kind: "seen",
      route: null,
      registration_number: null,
      seen: { method: "visit", photos: photos(MOD), report: report(MOD) },
    });
    const result = await own.decide({ checks: undefined });
    expect(!result.ok && result.error).toMatch(/different staff member/);
    expect(biz().seen_verified_at).toBeUndefined();
  });

  it("refuses when the ID shown didn't match or photos are missing", async () => {
    const noId = setup({
      kind: "seen",
      route: null,
      registration_number: null,
      seen: {
        method: "video",
        photos: photos("verifier"),
        report: report("verifier", { identityConfirmed: false }),
      },
    });
    expect(await noId.decide({ checks: undefined })).toMatchObject({ code: "evidence_missing" });
    const noPhotos = setup({
      kind: "seen",
      route: null,
      registration_number: null,
      seen: { method: "video", photos: [], report: report("verifier") },
    });
    expect(await noPhotos.decide({ checks: undefined })).toMatchObject({
      code: "evidence_missing",
    });
  });

  it("grants the sticker with the city only for visits", async () => {
    const { decide, biz } = setup(
      {
        kind: "seen",
        route: null,
        registration_number: null,
        seen: {
          method: "visit",
          address: "12 Main Road",
          photos: photos("verifier"),
          report: report("verifier"),
        },
      },
      {
        businesses: [
          {
            id: "biz-1",
            owner_id: OWNER,
            business_name: "Example Kitchen",
            location_city: "Empangeni",
          },
        ],
      }
    );
    expect(await decide({ checks: undefined })).toEqual({ ok: true, status: "approved" });
    expect(biz()).toMatchObject({ seen_method: "visit", seen_city: "Empangeni" });
    expect(biz().seen_verified_at).toBeTruthy();
    expect(JSON.stringify(biz())).not.toContain("12 Main Road");
  });

  it("uses the town the verifier visited when it differs from the profile", async () => {
    const { decide, biz } = setup(
      {
        kind: "seen",
        route: null,
        registration_number: null,
        seen: {
          method: "visit",
          address: "Shop 4, Richards Bay Mall",
          photos: photos("verifier"),
          report: report("verifier", { city: "Richards Bay" }),
        },
      },
      {
        businesses: [
          { id: "biz-1", owner_id: OWNER, business_name: "Branch", location_city: "Empangeni" },
        ],
      }
    );
    expect(await decide({ checks: undefined })).toEqual({ ok: true, status: "approved" });
    expect(biz()).toMatchObject({ seen_city: "Richards Bay" });
  });
});

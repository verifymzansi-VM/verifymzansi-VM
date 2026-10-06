// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "@/lib/business-verification/test-db";

type FakeDb = ReturnType<typeof createFakeDb>;

const state = vi.hoisted(() => ({
  user: { id: "owner-1" } as { id: string } | null,
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
const notify = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("@/lib/notifications", () => ({
  createNotification: notify,
  notifyStaffForAdminEvent: vi.fn().mockResolvedValue(true),
}));
const sendCode = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock("@/lib/services/email", () => ({
  sendWorkEmailCode: sendCode,
  sendBusinessVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { notifyConflictHolders } from "@/lib/business-verification/service";
import type { SupabaseClient } from "@supabase/supabase-js";

import { POST as link } from "./link/route";
import { POST as renew } from "./renew/route";
import { POST as routeSwitch } from "./route-switch/route";
import { POST as workEmail } from "./work-email/route";

const OWNER = "owner-1";
const BIZ = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const NUMBER = "2020/123456/07";
const V1 = "2026-10-06T08:00:00.000Z";
const params = Promise.resolve({ id: BIZ });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function seed(extra: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  state.db = createFakeDb({
    businesses: [{ id: BIZ, owner_id: OWNER, business_name: "Example Kitchen" }],
    account_profiles: [
      { user_id: OWNER, account_verification_status: "verified", account_status: "active" },
    ],
    verification_steps: [],
    business_verifications: [],
    business_verification_messages: [],
    notifications: [],
    ...extra,
  } as Record<string, Record<string, unknown>[]>);
}

const json = (path: string, body: unknown) =>
  new Request(`https://verifymzansi.com/api/businesses/${BIZ}/verification/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: OWNER };
  seed();
});

describe("renew", () => {
  const approved = (overrides: Record<string, unknown> = {}) => ({
    id: CASE,
    business_id: BIZ,
    owner_id: OWNER,
    kind: "cipc",
    status: "approved",
    route: "director",
    registration_number: NUMBER,
    decided_at: V1,
    ...overrides,
  });

  it("refuses to renew a removed sticker", async () => {
    seed({ business_verifications: [approved({ status: "revoked" })] });
    const res = await renew(json("renew", {}), { params });
    expect(await res.json()).toMatchObject({ code: "revoked" });
  });

  it("opens only in the last 60 days", async () => {
    seed({
      business_verifications: [approved()],
      businesses: [
        {
          id: BIZ,
          owner_id: OWNER,
          business_name: "Example Kitchen",
          cipc_expires_at: inDays(200),
        },
      ],
    });
    const res = await renew(json("renew", {}), { params });
    expect(await res.json()).toMatchObject({ code: "too_early" });
  });

  it("sends linked profiles to their main company profile", async () => {
    seed({ business_verifications: [approved({ kind: "cipc_link" })] });
    const res = await renew(json("renew", {}), { params });
    expect(await res.json()).toMatchObject({ code: "renews_with_source" });
  });

  it("opens a renewal case when the sticker is due", async () => {
    seed({
      business_verifications: [approved()],
      businesses: [
        { id: BIZ, owner_id: OWNER, business_name: "Example Kitchen", cipc_expires_at: inDays(20) },
      ],
    });
    const res = await renew(json("renew", {}), { params });
    expect(res.status).toBe(201);
    expect(state.db!.tables.business_verifications).toHaveLength(2);
  });
});

describe("link", () => {
  it("refuses to link a profile to itself", async () => {
    seed({
      businesses: [
        {
          id: BIZ,
          owner_id: OWNER,
          business_name: "Example Kitchen",
          cipc_verified_at: V1,
          cipc_expires_at: inDays(100),
          cipc_registration_number: NUMBER,
        },
      ],
    });
    const res = await link(json("link", { sourceBusinessId: BIZ }), { params });
    expect(res.status).toBe(400);
    expect(state.db!.tables.business_verifications).toHaveLength(0);
  });
});

describe("route-switch", () => {
  it("moves an open director request to the representative route", async () => {
    seed({
      business_verifications: [
        {
          id: CASE,
          business_id: BIZ,
          owner_id: OWNER,
          kind: "cipc",
          route: "director",
          status: "info_requested",
          checks: { exception: { proposedBy: "mod-1" } },
          updated_at: V1,
        },
      ],
    });
    const res = await routeSwitch(json("route-switch", { caseId: CASE }), { params });
    expect(res.status).toBe(200);
    expect(state.db!.tables.business_verifications[0]).toMatchObject({
      route: "representative",
      status: "pending",
      representative: {},
    });
    expect(state.db!.tables.business_verifications[0].checks).not.toHaveProperty("exception");
    expect(state.db!.tables.business_verification_messages).toHaveLength(1);
  });
});

describe("work-email", () => {
  const repCase = (representative: Record<string, unknown>) => ({
    id: CASE,
    business_id: BIZ,
    owner_id: OWNER,
    kind: "cipc",
    route: "representative",
    status: "pending",
    representative,
    updated_at: V1,
  });

  it("waits a minute between codes", async () => {
    seed({
      business_verifications: [repCase({ codeHash: "x", codeExpiresAt: inDays(15 / 1440) })],
    });
    const res = await workEmail(
      json("work-email", {
        action: "send",
        caseId: CASE,
        email: "thando@example-trading.co.za",
        position: "Marketing Manager",
      }),
      { params }
    );
    expect(res.status).toBe(429);
    expect(sendCode).not.toHaveBeenCalled();
  });

  it("refuses throwaway inboxes", async () => {
    seed({ business_verifications: [repCase({})] });
    const res = await workEmail(
      json("work-email", {
        action: "send",
        caseId: CASE,
        email: "someone@mailinator.com",
        position: "Manager",
      }),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it("counts a wrong code before comparing it", async () => {
    seed({
      business_verifications: [
        repCase({ codeHash: "not-the-hash", codeExpiresAt: inDays(1), attempts: 2 }),
      ],
    });
    const res = await workEmail(
      json("work-email", { action: "verify", caseId: CASE, code: "123456" }),
      {
        params,
      }
    );
    expect(res.status).toBe(400);
    expect(
      (state.db!.tables.business_verifications[0].representative as { attempts: number }).attempts
    ).toBe(3);
  });
});

describe("notifyConflictHolders", () => {
  it("tells a holder about the same number at most once a month", async () => {
    const holders = [{ ownerId: "holder-1", businessId: "b1", businessName: "Example Trading" }];
    const admin = state.db!.client as unknown as SupabaseClient;
    await notifyConflictHolders(admin, holders, NUMBER);
    expect(notify).toHaveBeenCalledOnce();
    state.db!.tables.notifications.push({
      user_id: "holder-1",
      title: "Someone else claimed your company",
      message: `Another account asked for the CIPC sticker using ${NUMBER}.`,
      created_at: new Date().toISOString(),
    });
    await notifyConflictHolders(admin, holders, NUMBER);
    expect(notify).toHaveBeenCalledOnce();
  });
});

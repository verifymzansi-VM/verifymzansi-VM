import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "./test-db";

const state = vi.hoisted(() => ({ db: null as ReturnType<typeof createFakeDb> | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db!.client }));

import { listQueue } from "./admin-queries";

const base = {
  owner_id: "owner-1",
  kind: "cipc",
  route: "director",
  status: "pending",
  registration_number: "2020/123456/07",
  checks: null,
  created_at: "2026-10-06T08:00:00.000Z",
  updated_at: "2026-10-06T08:00:00.000Z",
  decided_at: null,
};

beforeEach(() => {
  state.db = createFakeDb({
    business_verifications: [
      { ...base, id: "new", business_id: "b1", findings: [] },
      {
        ...base,
        id: "renew",
        business_id: "b2",
        findings: [{ code: "renewal", severity: "check" }],
      },
      {
        ...base,
        id: "clash",
        business_id: "b3",
        findings: [{ code: "conflict_other_owner", severity: "attention" }],
      },
      { ...base, id: "seen", business_id: "b4", kind: "seen", findings: [] },
    ],
    businesses: [],
    account_profiles: [],
  });
});

describe("listQueue", () => {
  it("puts one-tap renewals in their own tab, not the CIPC review tab", async () => {
    const review = await listQueue("review");
    expect(review.rows.map((r) => r.id)).toEqual(["new"]);
    const renewals = await listQueue("renewals");
    expect(renewals.rows.map((r) => r.id)).toEqual(["renew"]);
    expect(renewals.counts).toMatchObject({ review: 1, renewals: 1, conflicts: 1, visits: 1 });
  });
});

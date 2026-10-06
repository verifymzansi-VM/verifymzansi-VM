// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "@/lib/business-verification/test-db";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as ReturnType<typeof createFakeDb> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db!.client }));

import { GET } from "./route";

const BIZ = "11111111-1111-4111-8111-111111111111";
const caseRow = (id: string, owner: string, note: string) => ({
  id,
  business_id: BIZ,
  owner_id: owner,
  kind: "cipc",
  status: "rejected",
  route: "director",
  registration_number: "2020/123456/07",
  reason_code: "details_mismatch",
  review_note: note,
  created_at: "2026-10-01T00:00:00Z",
  decided_at: "2026-10-02T00:00:00Z",
  expires_at: null,
  seen: null,
  representative: null,
});

beforeEach(() => {
  state.user = { id: "new-owner" };
  state.db = createFakeDb({
    businesses: [{ id: BIZ, owner_id: "new-owner", business_name: "Example Kitchen" }],
    account_profiles: [
      { user_id: "new-owner", account_verification_status: "verified", account_status: "active" },
    ],
    verification_steps: [],
    business_verifications: [
      caseRow("old", "old-owner", "Private note for the previous owner"),
      caseRow("mine", "new-owner", "Note for the current owner"),
    ],
    business_verification_messages: [
      {
        id: "m1",
        case_id: "old",
        author_role: "staff",
        body: "Previous owner thread",
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
  });
});

describe("GET /api/businesses/[id]/verification", () => {
  it("shows only the current owner's own cases after a change of owner", async () => {
    const res = await GET(
      new Request(`https://verifymzansi.com/api/businesses/${BIZ}/verification`) as never,
      { params: Promise.resolve({ id: BIZ }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cases.map((c: { id: string }) => c.id)).toEqual(["mine"]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("Private note for the previous owner");
    expect(text).not.toContain("Previous owner thread");
  });
});

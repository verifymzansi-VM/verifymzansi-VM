import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { restoredProfileQuery } from "./restored-browser-client";
import { fetchFoundationAccountSession } from "./account-session-client";
vi.mock("./account-session-client", () => ({ fetchFoundationAccountSession: vi.fn() }));
const owner = "00000000-0000-4000-8000-000000000001";
const getUser = vi.fn();
const rpc = vi.fn();
const client = { auth: { getUser }, rpc } as unknown as SupabaseClient;
const dashboard = {
  version: 1,
  account_id: owner,
  generated_at: "2026-11-03T12:00:00Z",
  verification: {
    case_id: null,
    version: null,
    verified: false,
    phone_verified: false,
    locality_confirmed: false,
    submission_pending: false,
    return_reason: null,
  },
  profile_facts: {
    legal_name_locked_at: null,
    phone_changed_at: null,
    phone_verified_at: null,
    identity_reviewed_at: null,
    location_province: null,
    location_city: null,
    location_confirmed_at: null,
  },
  counts: {
    active_listings: 0,
    active_events: 0,
    rejected_listings: 2,
    pending_listings: 3,
    expiring_listings: 0,
    expiring_events: 0,
    businesses: 0,
    tourism_businesses: 0,
  },
  unread_leads: 4,
  unread_notifications: 5,
  organisation_admin_count: 0,
  posts: [],
  recent_leads: [],
  paid_plans: [],
};
const account = {
  version: 1 as const,
  account_id: owner,
  email: "owner@example.invalid",
  phone: null,
  totp_enrolled: false,
  staff: null,
  profile: {
    display_name: "Synthetic Member",
    public_name: "Synthetic Member",
    bio: null,
    avatar_object_id: null,
    legal_first_name: null,
    legal_last_name: null,
    legal_name_locked: false,
    identity_verified: false,
    revision: 1,
    updated_at: "2026-11-03T12:00:00Z",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({
    data: {
      user: {
        id: owner,
        created_at: "2026-11-03T12:00:00Z",
        user_metadata: { phone: "+27820000000", role: "admin" },
      },
    },
    error: null,
  });
  vi.mocked(fetchFoundationAccountSession).mockResolvedValue(account);
  rpc.mockResolvedValue({ data: dashboard, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("loads the existing onboarding fields through canonical self-only APIs", async () => {
  const result = await restoredProfileQuery(client).select().eq("user_id", owner).maybeSingle();
  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({
    user_id: owner,
    display_name: "Synthetic Member",
    phone: null,
    pending_phone: "+27820000000",
    account_verification_status: "incomplete",
  });
  expect(client.rpc).toHaveBeenCalledWith("get_my_dashboard", {}, { get: false });
});
it("rejects missing/different owner filters and direct writes before reading data", async () => {
  for (const query of [
    restoredProfileQuery(client),
    restoredProfileQuery(client).eq("user_id", "another"),
    restoredProfileQuery(client).eq("user_id", owner).update(),
  ]) {
    const result = await query.maybeSingle();
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  }
  expect(fetchFoundationAccountSession).not.toHaveBeenCalled();
});
it("refuses an account switch between the auth and canonical profile reads", async () => {
  vi.mocked(fetchFoundationAccountSession).mockResolvedValue({
    ...account,
    account_id: "00000000-0000-4000-8000-000000000002",
  });
  const result = await restoredProfileQuery(client).eq("user_id", owner).maybeSingle();
  expect(result.data).toBeNull();
  expect(result.error).toBeTruthy();
});
it("shares only in-flight reads for the current account and supplies canonical sidebar counts", async () => {
  const values = await Promise.all([
    restoredProfileQuery(client, "leads")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", owner)
      .eq("status", "new"),
    restoredProfileQuery(client, "notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", owner)
      .eq("read", false),
    restoredProfileQuery(client, "listings")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", owner)
      .eq("status", "rejected"),
    restoredProfileQuery(client, "listings")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", owner)
      .in("status", ["pending_moderation", "flagged_for_review"]),
  ]);
  expect(values.map((v) => v.count)).toEqual([4, 5, 2, 3]);
  expect(getUser).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(1);
  await restoredProfileQuery(client).eq("user_id", owner).maybeSingle();
  expect(rpc).toHaveBeenCalledTimes(2);
});
it("rejects unsupported/full collection queries instead of presenting a partial list as complete", async () => {
  const list = await restoredProfileQuery(client, "leads").select("*").eq("owner_id", owner);
  expect(list.error).toBeTruthy();
  expect(list.data).toBeNull();
  const filtered = await restoredProfileQuery(client, "listings")
    .select("id", { head: true })
    .eq("owner_id", owner)
    .eq("status", "live");
  expect(filtered.error).toBeTruthy();
});
it("refuses inconsistent verification facts instead of manufacturing approved steps", async () => {
  rpc.mockResolvedValue({
    data: { ...dashboard, verification: { ...dashboard.verification, verified: true } },
    error: null,
  });
  const result = await restoredProfileQuery(client, "verification_steps")
    .select("*")
    .eq("user_id", owner);
  expect(result.error).toBeTruthy();
  expect(result.data).toBeNull();
});

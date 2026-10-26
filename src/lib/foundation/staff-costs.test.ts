import { expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readFoundationStaffCosts, acknowledgeFoundationCostAlarm } from "./staff-costs";
const id = "00000000-0000-4000-8000-000000000001";
const when = "2026-10-26T12:00:00+00:00";
const data = {
  generated_at: when,
  lines: [
    {
      metric: "storage",
      label: "Storage",
      unit: "bytes",
      provider: "R2",
      period: "current",
      measurement: "database_observation",
      billing_scope: "unverified",
      source_url: null,
      used: "1024",
      free_quantity: "100000",
      percent_of_free: null,
      level: "unverified_allowance",
      overage_note: "Verify the provider allowance",
      verified_on: null,
    },
  ],
  drivers: {
    accounts: 1,
    new_accounts_this_month: 1,
    live_posts: 0,
    uploads_last_30_days: 1,
    average_bytes_per_live_post: "0",
    unused_media_bytes_awaiting_cleanup: "1024",
    expired_posts_awaiting_deletion: 0,
    evidence_files: 0,
    posts_by_status: {},
  },
  largest_storage_accounts: [{ account_id: id, bytes: "1024", live_posts: 0, package_posts: 0 }],
  open_alarms: [],
};
function client(value: unknown, error: { code: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: value, error });
  return { rpc, api: { rpc } as unknown as FoundationAuthenticatedApi };
}
it("uses the caller's cost command with no actor or service-role selector", async () => {
  const { api, rpc } = client(data);
  expect(await readFoundationStaffCosts(api)).toEqual(data);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("staff_cost_overview", {});
});
it.each([
  { ...data, lines: [] },
  { ...data, drivers: { ...data.drivers, accounts: -1 } },
  {
    ...data,
    largest_storage_accounts: [{ ...data.largest_storage_accounts[0], account_id: "wrong" }],
  },
  { ...data, email: "private@example.invalid" },
])("refuses malformed or unexpectedly expanded private read models (%#)", async (value) => {
  await expect(readFoundationStaffCosts(client(value).api)).rejects.toMatchObject({ status: 503 });
});
it("keeps revoked staff authority as a refusal", async () => {
  await expect(readFoundationStaffCosts(client(null, { code: "42501" }).api)).rejects.toMatchObject(
    { status: 403 }
  );
});
it("acknowledges only the requested alarm with the caller's authenticated command", async () => {
  const { api, rpc } = client({ id, acknowledged_at: when });
  expect(await acknowledgeFoundationCostAlarm(api, { alarm_id: id })).toEqual({
    id,
    acknowledged_at: when,
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("acknowledge_cost_alarm", { p_alarm_id: id });
});
it("rejects an injected actor before calling the backend", async () => {
  const { api, rpc } = client(null);
  await expect(
    acknowledgeFoundationCostAlarm(api, { alarm_id: id, actor_id: id })
  ).rejects.toMatchObject({ status: 400 });
  expect(rpc).not.toHaveBeenCalled();
});
it("does not mistake another alarm's acknowledgment for this request", async () => {
  const { api } = client({ id: "00000000-0000-4000-8000-000000000002", acknowledged_at: when });
  await expect(acknowledgeFoundationCostAlarm(api, { alarm_id: id })).rejects.toMatchObject({
    status: 503,
  });
});
it("requires a reload after an already acknowledged alarm", async () => {
  await expect(
    acknowledgeFoundationCostAlarm(client(null, { code: "22023" }).api, { alarm_id: id })
  ).rejects.toMatchObject({ status: 409 });
});

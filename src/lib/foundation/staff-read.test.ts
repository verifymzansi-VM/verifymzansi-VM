import { beforeEach, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readFoundationStaffAudit, readFoundationStaffDecisions } from "./staff-read";
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = "2026-10-27T00:00:00.123456+00:00";
const event = {
  id: "moderation:1",
  occurred_at: time,
  actor_id: id(1),
  actor_name: "Thando D.",
  target_id: id(4),
  target_type: "post",
  action: "post:approve",
  reason: null,
};
const decision = {
  id: id(7),
  case_id: id(8),
  subject_id: id(9),
  case_kind: "restriction",
  action: "reject",
  status: "proposed",
  case_version: 1,
  current_case_version: 1,
  proposed_by: id(2),
  proposed_at: time,
  approved_by: null,
  approved_at: null,
  withdrawn_by: null,
  withdrawn_at: null,
  withdrawal_reason: null,
  can_approve: true,
  can_withdraw: false,
};
beforeEach(() => {
  vi.clearAllMocks();
});
it("preserves microseconds in audit cursors and sends only validated filters", async () => {
  rpc.mockResolvedValue({
    data: { version: 1, items: [event], next_cursor: { before_at: time, before_id: event.id } },
    error: null,
  });
  const result = await readFoundationStaffAudit(api, {
    limit: 1,
    before_at: time,
    before_id: "moderation:2",
    actor: id(1),
  });
  expect(result.next_cursor?.before_at).toBe(time);
  expect(rpc).toHaveBeenCalledWith("staff_audit_page", {
    p_request: { limit: 1, before_at: time, before_id: "moderation:2", actor: id(1) },
  });
});
it.each([
  { actor_id: id(1) },
  { limit: 101 },
  { before_at: time },
  { actor: null },
  { action: "post_%" },
  { from: "2026-11-01", to: "2026-10-01" },
])("rejects invalid audit filters before RPC: %j", async (input) => {
  await expect(readFoundationStaffAudit(api, input)).rejects.toMatchObject({ status: 400 });
  expect(rpc).not.toHaveBeenCalled();
});
it("fails closed on duplicate or unexpectedly enriched audit rows", async () => {
  for (const items of [[event, event], [{ ...event, object_key: "private-object-marker" }]]) {
    rpc.mockResolvedValue({ data: { version: 1, items, next_cursor: null }, error: null });
    await expect(readFoundationStaffAudit(api)).rejects.toMatchObject({ status: 503 });
  }
});
it("requires a decision page to belong to the current caller", async () => {
  rpc.mockResolvedValue({
    data: { version: 1, caller_id: id(1), items: [decision], next_cursor: null },
    error: null,
  });
  expect((await readFoundationStaffDecisions(api, id(1))).items[0].can_approve).toBe(true);
  await expect(readFoundationStaffDecisions(api, id(3))).rejects.toMatchObject({ status: 503 });
});
it("refuses self-approval hints and mismatched decision filters", async () => {
  rpc.mockResolvedValue({
    data: { version: 1, caller_id: id(2), items: [decision], next_cursor: null },
    error: null,
  });
  await expect(readFoundationStaffDecisions(api, id(2))).rejects.toMatchObject({ status: 503 });
  rpc.mockResolvedValue({
    data: { version: 1, caller_id: id(1), items: [decision], next_cursor: null },
    error: null,
  });
  await expect(readFoundationStaffDecisions(api, id(1), { id: id(99) })).rejects.toMatchObject({
    status: 503,
  });
});
it("never accepts partial finalization state or raw proposal payloads", async () => {
  for (const row of [
    { ...decision, approved_by: id(1) },
    { ...decision, withdrawn_at: time },
    { ...decision, payload: { private: "marker" } },
  ]) {
    rpc.mockResolvedValue({
      data: { version: 1, caller_id: id(1), items: [row], next_cursor: null },
      error: null,
    });
    await expect(readFoundationStaffDecisions(api, id(1))).rejects.toMatchObject({ status: 503 });
  }
});
it("classifies native MFA refusals without exposing provider diagnostics", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { code: "42501", message: "recent second-factor verification required" },
  });
  await expect(readFoundationStaffAudit(api)).rejects.toMatchObject({
    status: 403,
    mfaRequired: true,
  });
  rpc.mockResolvedValue({
    data: null,
    error: { code: "XX000", message: "private-provider-marker" },
  });
  await expect(readFoundationStaffAudit(api)).rejects.not.toThrow("private-provider-marker");
});

/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { readFrontendAreaActivity } from "./area-activity";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
const actor = "11111111-1111-4111-8111-111111111111",
  target = "22222222-2222-4222-8222-222222222222";
const event = {
  id: `moderation:${target}`,
  actor_id: actor,
  target_id: target,
  target_type: "listing",
  area: "market",
  action: "content_approve",
  created_at: "2026-11-04T22:00:00Z",
};
const packet = () => ({ account_id: actor, area: "market", items: [event], today: { approve: 3 } });
it("maps the actual scoped activity/counts without importing privileged audit payloads", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: packet(), error: null });
  const result = await readFrontendAreaActivity(
    { rpc } as unknown as FoundationAuthenticatedApi,
    actor,
    "market",
    20
  );
  expect(result.today).toEqual({ approve: 3 });
  expect(result.items[0]).toMatchObject({
    action: "content_approve",
    area: "MZANSI_MARKET",
    metadata: {},
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "get_frontend_area_activity",
    { p_area: "market", p_limit: 20 },
    { get: false }
  );
});
it("refuses foreign accounts/programs, duplicate rows and added private fields", async () => {
  for (const data of [
    { ...packet(), account_id: target },
    { ...packet(), items: [{ ...event, area: "business" }] },
    { ...packet(), items: [event, event] },
    { ...packet(), items: [{ ...event, reason: "Private reviewer rationale" }] },
  ]) {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(
      readFrontendAreaActivity(
        { rpc } as unknown as FoundationAuthenticatedApi,
        actor,
        "market",
        20
      )
    ).rejects.toThrow();
  }
});
it("validates query bounds before contacting the database", async () => {
  const rpc = vi.fn();
  await expect(
    readFrontendAreaActivity({ rpc } as unknown as FoundationAuthenticatedApi, actor, "market", 101)
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});

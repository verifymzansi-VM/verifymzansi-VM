/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readReportsPage } from "./report-page";
import { readFoundationServerSession } from "../foundation/server-session";
import { createAdminClient } from "../supabase/admin";
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`Redirect:${url}`);
  }),
}));
vi.mock("../foundation/server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("../supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired report query used");
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
const actor = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  rpc = vi.fn();
const item = {
  id,
  target_id: id,
  target_type: "listing",
  area: "market",
  category: "misleading_info",
  selected_reason: "fake_listing",
  severity: "standard",
  status: "open",
  description: null,
  created_at: "2026-11-04T22:00:00Z",
  updated_at: "2026-11-04T22:00:00Z",
  claim: null,
  foundation: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.mocked(readFoundationServerSession).mockResolvedValue({
    user: { id: actor },
    api: { rpc },
  } as unknown as Awaited<ReturnType<typeof readFoundationServerSession>>);
  rpc.mockResolvedValue({
    data: { account_id: actor, open_total: 1, my_claims: 0, items: [item] },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("loads minimal report summaries from the native caller with actual waiting counts", async () => {
  const view = await readReportsPage(actor);
  expect(view.error).toBeNull();
  expect(view.openTotal).toBe(1);
  expect(view.reports[0]).toMatchObject({ id, category: "fake_listing", status: "open" });
  expect(view.reports[0]).not.toHaveProperty("description");
  expect(view.reports[0]).not.toHaveProperty("reporter_ip_hash");
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "get_frontend_report_review_queue",
    {},
    { get: false }
  );
});
it("carries the holder's actual body/fence and keeps claimed reports in waiting totals", async () => {
  const foundation = { expectedRevision: 2, claimGeneration: "4", claimNonce: id };
  rpc.mockResolvedValueOnce({
    data: {
      account_id: actor,
      open_total: 1,
      my_claims: 1,
      items: [
        {
          ...item,
          status: "in_progress",
          description: "A genuine fixture report",
          claim: { mine: true, holder_name: "you", expires_at: "2026-11-04T22:15:00Z" },
          foundation,
        },
      ],
    },
    error: null,
  });
  const view = await readReportsPage(actor);
  expect(view.error).toBeNull();
  expect(view.open).toHaveLength(1);
  expect(view.openTotal).toBe(1);
  expect(view.reports[0].foundation).toEqual(foundation);
  expect(view.claims[`report:${id}`].mine).toBe(true);
});
it("refuses foreign body exposure, account changes and failed reads instead of showing an empty queue", async () => {
  rpc.mockResolvedValueOnce({
    data: {
      account_id: actor,
      open_total: 1,
      my_claims: 0,
      items: [{ ...item, description: "Private report body" }],
    },
    error: null,
  });
  expect((await readReportsPage(actor)).error).toBeTruthy();
  rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
  expect((await readReportsPage(actor)).error).toBeTruthy();
  rpc.mockClear();
  expect((await readReportsPage(id)).error).toBeTruthy();
  expect(rpc).not.toHaveBeenCalled();
});
it("returns to reports when private review needs a fresh authenticator code", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent authenticator app proof required" },
  });
  await expect(readReportsPage(actor)).rejects.toThrow("Redirect:");
  expect(redirect).toHaveBeenCalledWith(expect.stringContaining("next=%2Fadmin%2Freports"));
});

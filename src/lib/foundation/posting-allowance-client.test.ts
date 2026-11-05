/** @vitest-environment jsdom */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fetchPostingAllowance } from "./posting-allowance-client";
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("../supabase/client", () => ({ createClient: () => ({ auth: { getUser } }) }));
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const account = (id: string) => ({ data: { user: { id } }, error: null });
const body = (id = owner) => ({
  posting: {
    account_id: id,
    profile_exists: true,
    capacity: 0,
    used: 0,
    creation_remaining: 0,
    max_photos: 10,
    max_videos: 1,
    tier: "free",
    trial_ends_at: null,
    trial_used: false,
    trial_offer: {
      eligible: true,
      sevenDayAvailable: true,
      thirtyDayAvailable: true,
      remaining: null,
      launchEnabled: true,
      shortDays: 7,
      longDays: 30,
    },
  },
  catalogue: { plans: [], addons: [] },
});
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetcher);
  getUser.mockResolvedValue(account(owner));
  fetcher.mockImplementation(async () => Response.json(body()));
});
afterEach(() => vi.unstubAllGlobals());
it("reads the current self-only API without old table reads or account parameters", async () => {
  expect((await fetchPostingAllowance("PROMOTIONS_EVENTS")).account_id).toBe(owner);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/billing/allowance?area=PROMOTIONS_EVENTS", {
    cache: "no-store",
    credentials: "same-origin",
  });
});
it("rejects another account's reply and an account switch during a read", async () => {
  fetcher.mockImplementationOnce(async () => Response.json(body(other)));
  await expect(fetchPostingAllowance("MZANSI_MARKET")).rejects.toThrow("not_authenticated");
  getUser.mockResolvedValueOnce(account(owner)).mockResolvedValueOnce(account(other));
  await expect(fetchPostingAllowance("MZANSI_MARKET")).rejects.toThrow("not_authenticated");
});
it("does not reuse another caller's cached allowance or fabricate success on failure", async () => {
  await fetchPostingAllowance("MZANSI_MARKET");
  getUser.mockResolvedValue(account(other));
  fetcher.mockImplementationOnce(async () => Response.json(body(other)));
  expect((await fetchPostingAllowance("MZANSI_MARKET")).account_id).toBe(other);
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
  await expect(fetchPostingAllowance("MZANSI_MARKET")).rejects.toThrow("failed");
});

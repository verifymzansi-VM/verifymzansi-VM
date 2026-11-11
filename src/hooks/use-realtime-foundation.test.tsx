import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRealtime } from "./use-realtime";
import { subscribeFoundationOwnerInbox } from "@/lib/foundation/owner-inbox-realtime";
vi.mock("@/lib/foundation/owner-inbox-realtime", () => ({
  subscribeFoundationOwnerInbox: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
const owner = "11111111-1111-4111-8111-111111111111";
const stop = vi.fn();
const client = { auth: { getSession: vi.fn() }, channel: vi.fn(), removeChannel: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  client.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: owner }, access_token: "fixture" } },
  });
  vi.mocked(subscribeFoundationOwnerInbox).mockResolvedValue(stop);
});
afterEach(() => vi.unstubAllEnvs());
it.each(["leads", "notifications"])(
  "uses the private owner signal instead of a public-table subscription for %s",
  async (table) => {
    const onEvent = vi.fn();
    const { unmount } = renderHook(() =>
      useRealtime({ table, filterColumn: "owner_id", filterValue: owner, onEvent })
    );
    await waitFor(() => expect(subscribeFoundationOwnerInbox).toHaveBeenCalledOnce());
    act(() => {
      vi.mocked(subscribeFoundationOwnerInbox).mock.calls[0][3]();
    });
    expect(onEvent).toHaveBeenCalledWith({ eventType: "REVALIDATE" });
    expect(client.channel).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  }
);
it("cleans up a subscription that finishes joining after the component unmounts", async () => {
  let finish: ((stop: () => void) => void) | undefined;
  vi.mocked(subscribeFoundationOwnerInbox).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const onEvent = vi.fn();
  const { unmount } = renderHook(() =>
    useRealtime({ table: "leads", filterValue: owner, onEvent })
  );
  await waitFor(() => expect(subscribeFoundationOwnerInbox).toHaveBeenCalledOnce());
  unmount();
  await act(async () => {
    finish?.(stop);
  });
  expect(stop).toHaveBeenCalledOnce();
  act(() => {
    vi.mocked(subscribeFoundationOwnerInbox).mock.calls[0][3]();
  });
  expect(onEvent).not.toHaveBeenCalled();
});
it("does not join another account's topic from a stale filter", async () => {
  renderHook(() =>
    useRealtime({
      table: "leads",
      filterValue: "22222222-2222-4222-8222-222222222222",
      onEvent: vi.fn(),
    })
  );
  await waitFor(() => expect(client.auth.getSession).toHaveBeenCalled());
  expect(subscribeFoundationOwnerInbox).not.toHaveBeenCalled();
});

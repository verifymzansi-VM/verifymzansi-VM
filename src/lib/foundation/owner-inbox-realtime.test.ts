import { expect, it, vi } from "vitest";
import { subscribeFoundationOwnerInbox } from "./owner-inbox-realtime";

it("joins only the caller's private topic and rereads on a content-free signal", async () => {
  let handler: (() => void) | undefined;
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, callback: () => void) => {
      handler = callback;
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
    realtime: { setAuth: vi.fn() },
  };
  const onChange = vi.fn();
  const account = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
  const stop = await subscribeFoundationOwnerInbox(client as never, account, "token", onChange);
  expect(client.realtime.setAuth).toHaveBeenCalledWith("token");
  expect(client.channel).toHaveBeenCalledWith("owner:" + account.toLowerCase(), {
    config: { private: true },
  });
  expect(channel.on).toHaveBeenCalledWith(
    "broadcast",
    { event: "inbox_changed" },
    expect.any(Function)
  );
  handler?.();
  expect(onChange).toHaveBeenCalledOnce();
  stop();
  expect(client.removeChannel).toHaveBeenCalledWith(channel);
  await expect(
    subscribeFoundationOwnerInbox(client as never, "owner:someone", "token", onChange)
  ).rejects.toThrow();
});

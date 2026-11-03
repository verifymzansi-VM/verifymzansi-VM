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
it("shares one private channel and releases it only after the final subscriber leaves", async () => {
  let signal: (() => void) | undefined;
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, cb: () => void) => {
      signal = cb;
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
    realtime: { setAuth: vi.fn() },
  };
  const owner = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const first = vi.fn(),
    second = vi.fn();
  const [stopFirst, stopSecond] = await Promise.all([
    subscribeFoundationOwnerInbox(client as never, owner, "token", first),
    subscribeFoundationOwnerInbox(client as never, owner, "token", second),
  ]);
  expect(client.channel).toHaveBeenCalledTimes(1);
  expect(client.realtime.setAuth).toHaveBeenCalledTimes(1);
  signal?.();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  stopFirst();
  expect(client.removeChannel).not.toHaveBeenCalled();
  signal?.();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledTimes(2);
  stopSecond();
  stopSecond();
  expect(client.removeChannel).toHaveBeenCalledTimes(1);
});
it("drops failed joins so a later valid subscription can recover", async () => {
  const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
    realtime: {
      setAuth: vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined),
    },
  };
  const owner = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  await expect(
    subscribeFoundationOwnerInbox(client as never, owner, "token", vi.fn())
  ).rejects.toThrow();
  const stop = await subscribeFoundationOwnerInbox(client as never, owner, "token", vi.fn());
  expect(client.channel).toHaveBeenCalledOnce();
  stop();
});

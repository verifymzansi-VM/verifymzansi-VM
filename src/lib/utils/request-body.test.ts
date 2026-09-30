import { describe, expect, it, vi } from "vitest";
import { readBoundedRequestText, RequestBodyTooLargeError } from "./request-body";
import { parseJsonRequest } from "./api";

describe("bounded request bodies", () => {
  it("counts UTF-8 bytes rather than characters", async () => {
    const request = new Request("http://localhost", { method: "POST", body: '"éé"' });
    await expect(readBoundedRequestText(request, 5)).rejects.toThrow(RequestBodyTooLargeError);
  });

  it("decodes multibyte characters split across chunks at the exact limit", async () => {
    const bytes = new TextEncoder().encode('"é"');
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    expect(await readBoundedRequestText({ body: stream, text: vi.fn() }, bytes.length)).toBe('"é"');
  });

  it("cancels an oversized stream without consuming the rest, even with a false length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(100));
      },
      cancel,
    });
    await expect(
      readBoundedRequestText(
        { body: stream, text: vi.fn(), headers: new Headers({ "content-length": "1" }) },
        4
      )
    ).rejects.toThrow(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("rejects oversized declared lengths before reading", async () => {
    const text = vi.fn();
    await expect(
      readBoundedRequestText({ text, headers: new Headers({ "content-length": "100" }) }, 4)
    ).rejects.toThrow(RequestBodyTooLargeError);
    expect(text).not.toHaveBeenCalled();
  });

  it("does not exempt JSON-only adapters from the limit", async () => {
    expect(
      await parseJsonRequest({ json: async () => ({ value: "éé" }) }, { maxBytes: 10 })
    ).toBeNull();
  });

  it("returns null for unreadable request streams", async () => {
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.error(new Error("Disconnected"));
      },
    });
    expect(await parseJsonRequest({ body, text: vi.fn() })).toBeNull();
    expect(body.locked).toBe(false);
  });
});

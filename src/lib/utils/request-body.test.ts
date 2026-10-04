// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  readBoundedRequestText,
  readBoundedRequestFormData,
  RequestBodyTooLargeError,
} from "./request-body";
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

describe("bounded multipart request bodies", () => {
  const url = "http://localhost/upload";

  it("preserves binary files and Unicode fields at the exact byte limit", async () => {
    const form = new FormData();
    form.set("name", "é");
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    form.set("file", new File([bytes], "avatar.png", { type: "image/png" }));
    const request = new Request(url, { method: "POST", body: form });
    const size = (await request.clone().arrayBuffer()).byteLength;
    const parsed = await readBoundedRequestFormData(request, size);
    expect(parsed.get("name")).toBe("é");
    const file = parsed.get("file") as File;
    expect(file.name).toBe("avatar.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it.each([null, "1"])("rejects oversized streams with content-length %s", async (length) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(1024)], "file.png"));
    const request = new Request(url, { method: "POST", body: form });
    if (length) request.headers.set("content-length", length);
    await expect(readBoundedRequestFormData(request, 512)).rejects.toThrow(
      RequestBodyTooLargeError
    );
  });

  it("cancels the source when it crosses the limit, before consuming later chunks", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel,
    });
    await expect(
      readBoundedRequestFormData(
        {
          body: stream,
          headers: new Headers({ "content-type": "multipart/form-data; boundary=b" }),
          formData: vi.fn(),
        },
        512
      )
    ).rejects.toThrow(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a declared oversize without invoking the multipart parser", async () => {
    const formData = vi.fn();
    await expect(
      readBoundedRequestFormData({ formData, headers: new Headers({ "content-length": "100" }) }, 4)
    ).rejects.toThrow(RequestBodyTooLargeError);
    expect(formData).not.toHaveBeenCalled();
  });

  it("keeps malformed multipart errors distinct from size rejections", async () => {
    const request = new Request(url, {
      method: "POST",
      body: "broken",
      headers: { "content-type": "multipart/form-data" },
    });
    await expect(readBoundedRequestFormData(request, 100)).rejects.not.toBeInstanceOf(
      RequestBodyTooLargeError
    );
  });

  it("cancels an unread stream when the multipart content type is invalid", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel });
    await expect(
      readBoundedRequestFormData(
        {
          body,
          headers: new Headers({ "content-type": "text/plain" }),
          formData: vi.fn(),
        },
        1024
      )
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("also bounds internal parsed adapters", async () => {
    const form = new FormData();
    form.set("field", "éé");
    await expect(readBoundedRequestFormData({ formData: async () => form }, 8)).rejects.toThrow(
      RequestBodyTooLargeError
    );
  });
});

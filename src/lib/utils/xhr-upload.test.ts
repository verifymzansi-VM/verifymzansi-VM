import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch-retry";
import { xhrFetch } from "./xhr-upload";

class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  statusText = "";
  responseText = "";
  responseType = "";
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  getAllResponseHeaders() {
    return "content-type: application/json\r\nx-trace-id: abc\r\n";
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  respond(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

describe("xhrFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports upload percent and resolves a Response with status, body and headers", async () => {
    const percents: number[] = [];
    const body = new FormData();
    const pending = xhrFetch(
      "/api/media/upload",
      { method: "POST", headers: { "x-csrf-token": "t" }, body },
      (percent) => percents.push(percent)
    );
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.headers["x-csrf-token"]).toBe("t");
    expect(xhr.body).toBe(body);

    xhr.progress(25, 100);
    xhr.progress(100, 100);
    xhr.respond(201, '{"urls":["u"]}');
    const response = await pending;

    expect(percents).toEqual([25, 100]);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-trace-id")).toBe("abc");
    expect(await response.json()).toEqual({ urls: ["u"] });
  });

  it("rejects a network failure with a TypeError, as fetch does", async () => {
    const pending = xhrFetch("/api/media/upload", { method: "POST" });
    FakeXhr.last.onerror?.();
    await expect(pending).rejects.toBeInstanceOf(TypeError);
  });

  it("aborts the request and rejects with the signal's reason", async () => {
    const controller = new AbortController();
    const pending = xhrFetch("/api/media/upload", { method: "POST", signal: controller.signal });
    const reason = new DOMException("The operation was aborted", "AbortError");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(FakeXhr.last.aborted).toBe(true);
  });

  it("resolves an error status with its body so callers can read the message", async () => {
    const pending = xhrFetch("/api/media/upload", { method: "POST" });
    FakeXhr.last.respond(413, '{"error":"Too large"}');
    const response = await pending;
    expect(response.ok).toBe(false);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Too large" });
  });

  it("gives an AbortError when fetchWithRetry's timeout fires", async () => {
    vi.useFakeTimers();
    try {
      const pending = fetchWithRetry(
        "/api/media/upload",
        { method: "POST" },
        0,
        1000,
        (input, init) => xhrFetch(input, init)
      );
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(FakeXhr.last.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

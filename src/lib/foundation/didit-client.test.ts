/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDiditSession,
  deleteDiditSession,
  diditConfig,
  DiditError,
  fetchDiditDecision,
  fetchDiditImage,
} from "./didit-client";
vi.mock("server-only", () => ({}));

const config = { apiKey: "fixture-key", workflowId: "77777777-7777-4777-8777-777777777777" };
const check = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const fetchMock = vi.fn();
const reply = (status: number, body: unknown = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("settings", () => {
  it("needs the key and a workflow id", () => {
    expect(diditConfig({ DIDIT_API_KEY: " k ", DIDIT_WORKFLOW_ID: config.workflowId })).toEqual({
      apiKey: "k",
      workflowId: config.workflowId,
    });
    expect(diditConfig({ DIDIT_API_KEY: "k" })).toBeNull();
    expect(diditConfig({ DIDIT_API_KEY: "k", DIDIT_WORKFLOW_ID: "not-a-uuid" })).toBeNull();
    expect(diditConfig({ DIDIT_WORKFLOW_ID: config.workflowId })).toBeNull();
  });
});

describe("a new session", () => {
  it("sends only the check id (no name, contact, network or device), and answers the frame link", async () => {
    fetchMock.mockResolvedValue(
      reply(201, {
        session_id: session,
        url: `https://verify.didit.me/session/abc`,
        status: "Not Started",
      })
    );
    expect(await createDiditSession(config, check)).toEqual({
      sessionId: session,
      url: "https://verify.didit.me/session/abc",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://verification.didit.me/v3/session/");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("fixture-key");
    expect(JSON.parse(init.body)).toEqual({
      workflow_id: config.workflowId,
      vendor_data: check,
    });
  });

  it("refuses a link outside the frame origin", async () => {
    fetchMock.mockResolvedValue(reply(201, { session_id: session, url: "https://evil.example/x" }));
    await expect(createDiditSession(config, check)).rejects.toMatchObject({ reason: "outage" });
  });

  it("names why the partner refused: credit, our settings or the partner", async () => {
    const cases: [Response | Error, string][] = [
      [reply(400, { detail: "You don't have enough credits" }), "no_credit"],
      [reply(402, "insufficient balance"), "no_credit"],
      [reply(401), "not_configured"],
      [reply(403), "not_configured"],
      [reply(404), "not_configured"],
      [reply(400, { detail: "workflow_id invalid" }), "not_configured"],
      [reply(500), "outage"],
      [reply(429), "outage"],
      [new TypeError("network"), "outage"],
    ];
    for (const [answer, reason] of cases) {
      if (answer instanceof Error) fetchMock.mockRejectedValueOnce(answer);
      else fetchMock.mockResolvedValueOnce(answer);
      const failure = await createDiditSession(config, check).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DiditError);
      expect((failure as DiditError).reason).toBe(reason);
    }
  });
});

describe("decisions, deletions and photos", () => {
  it("reads a decision from the partner", async () => {
    fetchMock.mockResolvedValue(reply(200, { session_id: session, status: "Approved", extra: 1 }));
    expect(await fetchDiditDecision(config, session)).toMatchObject({ status: "Approved" });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `https://verification.didit.me/v3/session/${session}/decision/`
    );
  });

  it("deletes a session with its face data; an already deleted one counts as deleted", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(reply(404));
    await deleteDiditSession(config, session);
    await deleteDiditSession(config, session);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://verification.didit.me/v3/session/${session}/delete/`);
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ deletion_instruction: "privacy_erasure" });
    fetchMock.mockResolvedValueOnce(reply(500));
    await expect(deleteDiditSession(config, session)).rejects.toBeInstanceOf(DiditError);
  });

  it("fetches a photo from an allowed host only, without our key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    expect(await fetchDiditImage("https://media.didit.me/a.jpg?sig=1")).toEqual(
      Buffer.from([1, 2, 3])
    );
    expect(fetchMock.mock.calls[0]![1].headers).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([4]), { status: 200 }));
    await fetchDiditImage("https://bucket.s3.eu-west-1.amazonaws.com/a.jpg?X-Amz-Signature=1");
    for (const url of [
      "http://media.didit.me/a.jpg",
      "https://user:pass@media.didit.me/a.jpg",
      "https://media.didit.me:8443/a.jpg",
      "https://images.example/a.jpg",
      "https://didit.me.evil.example/a.jpg",
      "https://evil-didit.me/a.jpg",
      "https://s3.amazonaws.com/a.jpg",
      "https://bucket.s3.a.b.c.amazonaws.com/a.jpg",
      "https://execute-api.amazonaws.com/a.jpg",
      "not a link",
    ])
      await expect(fetchDiditImage(url)).rejects.toMatchObject({ reason: "outage" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks a long hostile host name quickly (no pattern backtracking)", async () => {
    const hostile = `a${"-.s3-".repeat(2000)}${"--".repeat(5000)}.example`;
    const started = performance.now();
    await expect(fetchDiditImage(`https://${hostile}/a.jpg`)).rejects.toMatchObject({
      detail: "media_host",
    });
    expect(performance.now() - started).toBeLessThan(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops reading a photo at the size limit, declared or not", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x", { status: 200, headers: { "content-length": String(6 * 1024 * 1024) } })
    );
    await expect(fetchDiditImage("https://media.didit.me/big.jpg")).rejects.toMatchObject({
      detail: "media_size",
    });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(endless, { status: 200 }));
    await expect(fetchDiditImage("https://media.didit.me/stream.jpg")).rejects.toMatchObject({
      detail: "media_size",
    });
    expect(pulled).toBeLessThanOrEqual(8);
  });
});

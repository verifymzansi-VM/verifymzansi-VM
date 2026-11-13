/** @vitest-environment node */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic settings only: no real Ozow key, and every request below is
// answered by a fake fetch. Nothing in this file can reach Ozow.
const envMap: Record<string, string> = { OZOW_ENV: "staging" };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ env: vi.fn((key: string) => envMap[key] ?? "") }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const TX = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
const REFUND = "b1fa5055-19c5-41ab-86dd-15272d103455";
const KEY = "vm-refund-11111111-2222-4333-8444-555555555555";
const environment = {
  OZOW_API_REFUNDS_ENABLED: "true",
  OZOW_REFUND_CLIENT_ID: "synthetic-refund-client",
  OZOW_REFUND_CLIENT_SECRET: "synthetic-refund-secret",
  OZOW_SITE_CODE: "SYN-001",
};
const refundBody = (overrides: Record<string, unknown> = {}) => ({
  links: { self: `https://stagingone.ozow.com/v1/refunds/${REFUND}` },
  id: REFUND,
  transactionId: TX,
  amount: { currency: "ZAR", value: 69 },
  requested: "2026-11-13T09:30:00Z",
  status: "Pending",
  realTimePayment: false,
  ...overrides,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const token = (init?: RequestInit) =>
  json({ access_token: "synthetic-token", expires_in: init ? 3600 : 0 });

async function load() {
  vi.resetModules();
  return import("./ozow-refunds");
}
function fakeFetch(...answers: Array<Response | Error>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/token")) return token(init);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const sent = (fetcher: ReturnType<typeof fakeFetch>) =>
  fetcher.mock.calls.filter(([input]) => !String(input).endsWith("/v1/token"));

const mockSetting = process.env.ENABLE_MOCK_OZOW;
beforeEach(() => {
  delete process.env.ENABLE_MOCK_OZOW;
});
afterAll(() => {
  if (mockSetting === undefined) delete process.env.ENABLE_MOCK_OZOW;
  else process.env.ENABLE_MOCK_OZOW = mockSetting;
});
afterEach(() => vi.unstubAllGlobals());

describe("the switch", () => {
  it("is on only for the exact value 'true' with the refund key set", async () => {
    const { ozowApiRefundsEnabled } = await load();
    expect(ozowApiRefundsEnabled(environment)).toBe(true);
    for (const value of ["TRUE", "1", "yes", " true", "", undefined])
      expect(ozowApiRefundsEnabled({ ...environment, OZOW_API_REFUNDS_ENABLED: value })).toBe(
        false
      );
    expect(ozowApiRefundsEnabled({ ...environment, OZOW_REFUND_CLIENT_SECRET: "" })).toBe(false);
    // The payment key never stands in for the refund key.
    expect(
      ozowApiRefundsEnabled({
        OZOW_API_REFUNDS_ENABLED: "true",
        OZOW_CLIENT_ID: "payment-client",
        OZOW_CLIENT_SECRET: "payment-secret",
      })
    ).toBe(false);
  });

  it("stays off with mock Ozow", async () => {
    process.env.ENABLE_MOCK_OZOW = "true";
    const { ozowApiRefundsEnabled } = await load();
    expect(ozowApiRefundsEnabled(environment)).toBe(false);
  });
});

describe("reading Ozow's refunds", () => {
  it("reads statuses as text or numbers and refuses anything else", async () => {
    const { readOzowRefundStatus } = await load();
    expect(readOzowRefundStatus("complete")).toBe("Complete");
    expect(readOzowRefundStatus(1)).toBe("Complete");
    expect(readOzowRefundStatus("5")).toBe("Returned");
    expect(readOzowRefundStatus(-2)).toBe("PendingInvestigation");
    expect(readOzowRefundStatus("Refunded")).toBeNull();
    expect(readOzowRefundStatus(9)).toBeNull();
  });

  it("keeps exact cents and refuses partial cents, other currencies or ids", async () => {
    const { readOzowRefund, randsToCents } = await load();
    expect(randsToCents(69)).toBe(6900);
    expect(randsToCents("1035.5")).toBe(103550);
    expect(randsToCents(24.999)).toBeNull();
    expect(randsToCents(-1)).toBeNull();
    expect(readOzowRefund(refundBody())).toMatchObject({
      refundId: REFUND,
      transactionId: TX,
      amountCents: 6900,
      status: "Pending",
    });
    expect(readOzowRefund(refundBody({ amount: { currency: "USD", value: 69 } }))).toBeNull();
    expect(readOzowRefund(refundBody({ id: "not-a-refund" }))).toBeNull();
    expect(readOzowRefund(refundBody({ status: "Refunded" }))).toBeNull();
  });
});

describe("sending a refund", () => {
  const send = {
    transactionId: TX,
    amountCents: 6900,
    reason: "VerifyMzansi refund: duplicate",
    idempotencyKey: KEY,
  };

  it("posts once with the record's Idempotency-Key and the refunds scope", async () => {
    const fetcher = fakeFetch(json(refundBody(), 201));
    const { createOzowRefundClient } = await load();
    const result = await createOzowRefundClient({ environment }).create(send);
    expect(result).toMatchObject({
      outcome: "accepted",
      fact: { refundId: REFUND, amountCents: 6900 },
    });
    const [url, init] = sent(fetcher)[0] as [URL, RequestInit];
    expect(String(url)).toBe(`https://stagingone.ozow.com/v1/transactions/${TX}/refunds`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({
      amount: { currency: "ZAR", value: 69 },
      reason: "VerifyMzansi refund: duplicate",
      realTimePayment: false,
    });
    const tokenCall = fetcher.mock.calls.find(([input]) => String(input).endsWith("/v1/token"));
    const form = new URLSearchParams(String((tokenCall?.[1] as RequestInit).body));
    expect(form.get("scope")).toBe("refunds");
    expect(form.get("client_id")).toBe("synthetic-refund-client");
    expect(sent(fetcher)).toHaveLength(1);
  });

  it("posts once: a lost answer or a server error is unknown, never retried here", async () => {
    let fetcher = fakeFetch(new Error("network"));
    let mod = await load();
    expect(await mod.createOzowRefundClient({ environment }).create(send)).toEqual({
      outcome: "unknown",
      status: null,
    });
    expect(sent(fetcher)).toHaveLength(1);
    fetcher = fakeFetch(json({ title: "busy" }, 503));
    mod = await load();
    expect(await mod.createOzowRefundClient({ environment }).create(send)).toEqual({
      outcome: "unknown",
      status: 503,
    });
    expect(sent(fetcher)).toHaveLength(1);
  });

  it("sends the same request again only after an expired token (401: Ozow did nothing)", async () => {
    const fetcher = fakeFetch(json({}, 401), json(refundBody(), 201));
    const { createOzowRefundClient } = await load();
    expect(await createOzowRefundClient({ environment }).create(send)).toMatchObject({
      outcome: "accepted",
    });
    const keys = sent(fetcher).map(
      ([, init]) => ((init as RequestInit).headers as Record<string, string>)["Idempotency-Key"]
    );
    expect(keys).toEqual([KEY, KEY]);
  });

  it("reports a refusal only when Ozow refused (nothing made)", async () => {
    fakeFetch(json({ title: "Bad request" }, 400));
    const { createOzowRefundClient } = await load();
    expect(await createOzowRefundClient({ environment }).create(send)).toEqual({
      outcome: "refused",
      failureReason: "ozow_refused",
      status: 400,
    });
    fakeFetch(json({ title: "Forbidden" }, 403));
    const again = await load();
    expect(await again.createOzowRefundClient({ environment }).create(send)).toMatchObject({
      outcome: "refused",
      failureReason: "ozow_auth",
    });
  });

  it("treats a conflict or an answer it cannot match as unknown, never as refused", async () => {
    fakeFetch(json({}, 409));
    let mod = await load();
    expect(await mod.createOzowRefundClient({ environment }).create(send)).toEqual({
      outcome: "unknown",
      status: 409,
    });
    fakeFetch(json(refundBody({ amount: { currency: "ZAR", value: 70 } }), 201));
    mod = await load();
    expect(await mod.createOzowRefundClient({ environment }).create(send)).toMatchObject({
      outcome: "unknown",
    });
  });

  it("refuses to run with mock Ozow or without the refund key, before any request", async () => {
    const fetcher = fakeFetch();
    process.env.ENABLE_MOCK_OZOW = "true";
    let mod = await load();
    await expect(mod.createOzowRefundClient({ environment }).create(send)).rejects.toThrow(
      /mock Ozow/
    );
    delete process.env.ENABLE_MOCK_OZOW;
    mod = await load();
    await expect(
      mod.createOzowRefundClient({ environment: { OZOW_API_REFUNDS_ENABLED: "true" } }).prepare()
    ).rejects.toThrow(/refund key/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("reading refunds back", () => {
  it("reads one refund and refuses another id", async () => {
    fakeFetch(json(refundBody({ status: 1 })));
    let mod = await load();
    expect(await mod.createOzowRefundClient({ environment }).get(REFUND)).toMatchObject({
      status: "Complete",
    });
    fakeFetch(json(refundBody({ id: "c2fa5055-19c5-41ab-86dd-15272d103455" })));
    mod = await load();
    await expect(mod.createOzowRefundClient({ environment }).get(REFUND)).rejects.toThrow(
      /invalid refund/
    );
    fakeFetch(json({ title: "Not found" }, 404));
    mod = await load();
    await expect(mod.createOzowRefundClient({ environment }).get(REFUND)).rejects.toBeInstanceOf(
      mod.OzowRefundNotFoundError
    );
  });

  it("reads a transaction's refunds and refuses another transaction's", async () => {
    fakeFetch(json({ results: [refundBody()] }));
    let mod = await load();
    expect(await mod.createOzowRefundClient({ environment }).transactionRefunds(TX)).toHaveLength(
      1
    );
    fakeFetch(json([refundBody({ transactionId: "c2fa5055-19c5-41ab-86dd-15272d103455" })]));
    mod = await load();
    await expect(
      mod.createOzowRefundClient({ environment }).transactionRefunds(TX)
    ).rejects.toThrow(/list item/);
    // A further page means the list is not complete: never "no such refund".
    fakeFetch(json({ results: [], links: { next: "https://stagingone.ozow.com/v1/x?offset=50" } }));
    mod = await load();
    await expect(
      mod.createOzowRefundClient({ environment }).transactionRefunds(TX)
    ).rejects.toThrow(/not complete/);
    // A total larger than what came back: not complete either.
    fakeFetch(json({ results: [refundBody()], total: 3 }));
    mod = await load();
    await expect(
      mod.createOzowRefundClient({ environment }).transactionRefunds(TX)
    ).rejects.toThrow(/not complete/);
  });

  it("lists by date, follows Ozow's next link on Ozow's origin only", async () => {
    const page = (next: string | null, items: unknown[]) =>
      json({ links: { next }, results: items, meta: { totalPages: 2, totalItems: 2 } });
    const fetcher = fakeFetch(
      page("https://stagingone.ozow.com/v1/refunds?offset=50", [refundBody()]),
      page(null, [
        refundBody({ id: "c2fa5055-19c5-41ab-86dd-15272d103455" }),
        refundBody({ id: "d3fa5055-19c5-41ab-86dd-15272d103455", status: "Refunded" }),
      ])
    );
    let mod = await load();
    const { facts, unreadable } = await mod
      .createOzowRefundClient({ environment })
      .list(new Date("2026-11-10T00:00:00Z"), new Date("2026-11-13T00:00:00Z"));
    expect(facts).toHaveLength(2);
    expect(unreadable).toBe(1);
    const first = new URL(String(sent(fetcher)[0][0]));
    expect(first.searchParams.get("fromDate")).toBe("2026-11-10T00:00:00.000Z");
    expect(first.searchParams.get("siteCode")).toBe("SYN-001");
    fakeFetch(page("https://evil.example.invalid/v1/refunds", [refundBody()]));
    mod = await load();
    await expect(
      mod.createOzowRefundClient({ environment }).list(new Date(), new Date())
    ).rejects.toThrow(/Invalid Ozow refund link/);
  });
});

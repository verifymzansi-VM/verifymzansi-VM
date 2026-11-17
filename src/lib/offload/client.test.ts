/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudflare = vi.hoisted(() => ({ env: {} as Record<string, unknown>, inWorker: false }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => {
    if (!cloudflare.inWorker) throw new Error("not in a Worker");
    return { env: cloudflare.env };
  },
}));
const local = vi.hoisted(() => ({ extractPdfHere: vi.fn(), renderShareCardHere: vi.fn() }));
vi.mock("@/lib/offload/local", () => local);

import { OffloadUnavailableError, readPdf, renderShareCard } from "./client";
import { OFFLOAD_ORIGIN, OFFLOAD_PDF_PATH, OFFLOAD_SHARE_CARD_PATH } from "./protocol";

const card = {
  title: "Garden cottage",
  section: "Mzansi Market",
  price: "R850",
  location: "Richards Bay, KwaZulu-Natal",
  hasVideo: false,
};
const extracted = {
  items: [{ x: 72, y: 700, text: "ONE" }],
  structure: { pageCount: 1, hasTextLayer: true },
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function inWorker(binding: unknown) {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  cloudflare.inWorker = true;
  cloudflare.env = binding === undefined ? {} : { OFFLOAD: binding };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  cloudflare.inWorker = false;
  cloudflare.env = {};
});

describe("outside a Worker (Node)", () => {
  it("reads PDFs and draws cards in this process", async () => {
    local.extractPdfHere.mockResolvedValue(extracted);
    local.renderShareCardHere.mockResolvedValue(png.buffer);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await readPdf(bytes)).toBe(extracted);
    expect(local.extractPdfHere).toHaveBeenCalledWith(bytes);
    expect(await renderShareCard(card)).toBe(png.buffer);
    expect(local.renderShareCardHere).toHaveBeenCalledWith(card);
  });

  it("ignores the local wrangler proxy's OFFLOAD service, which has no Worker behind it", async () => {
    const fetch = vi.fn(async () => new Response("no local dev session", { status: 503 }));
    cloudflare.inWorker = true;
    cloudflare.env = { OFFLOAD: { fetch } };
    local.extractPdfHere.mockResolvedValue(extracted);
    expect(await readPdf(new Uint8Array([1]))).toBe(extracted);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("inside the Worker", () => {
  it("sends the PDF bytes to the offload Worker and returns its reading", async () => {
    const fetch = vi.fn(async () => Response.json({ result: extracted }));
    inWorker({ fetch });
    const bytes = new Uint8Array([37, 80, 68, 70]);
    expect(await readPdf(bytes)).toEqual(extracted);
    expect(fetch).toHaveBeenCalledWith(OFFLOAD_ORIGIN + OFFLOAD_PDF_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: bytes,
    });
    expect(local.extractPdfHere).not.toHaveBeenCalled();
  });

  it("passes on an unreadable PDF as null", async () => {
    inWorker({ fetch: async () => Response.json({ result: null }) });
    expect(await readPdf(new Uint8Array([1]))).toBeNull();
  });

  it("sends the card fields and returns the PNG", async () => {
    const fetch = vi.fn(
      async () => new Response(png, { headers: { "Content-Type": "image/png" } })
    );
    inWorker({ fetch });
    expect(new Uint8Array(await renderShareCard(card))).toEqual(png);
    expect(fetch).toHaveBeenCalledWith(OFFLOAD_ORIGIN + OFFLOAD_SHARE_CARD_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    expect(local.renderShareCardHere).not.toHaveBeenCalled();
  });

  it.each([
    ["the Worker context cannot be read", "no-context"],
    ["the binding is missing", undefined],
    ["the binding is not a service", { nope: true }],
    [
      "the offload Worker cannot be reached",
      {
        fetch: async () => {
          throw new Error("network");
        },
      },
    ],
    ["the offload Worker fails", { fetch: async () => new Response("x", { status: 500 }) }],
    ["the reply is not a reading", { fetch: async () => Response.json({ result: { items: 1 } }) }],
    ["the reply is not JSON", { fetch: async () => new Response("<html>") }],
  ])("refuses to guess when %s", async (_case, binding) => {
    inWorker(binding);
    if (binding === "no-context") cloudflare.inWorker = false;
    await expect(readPdf(new Uint8Array([1]))).rejects.toBeInstanceOf(OffloadUnavailableError);
    await expect(renderShareCard(card)).rejects.toBeInstanceOf(OffloadUnavailableError);
    expect(local.extractPdfHere).not.toHaveBeenCalled();
    expect(local.renderShareCardHere).not.toHaveBeenCalled();
  });
});

// verifymzansi-offload: heavy server-only work the main website Worker hands
// over through its OFFLOAD service binding, so the main Worker stays well
// under Cloudflare's 10 MB size limit (M9.9).
//
// - POST /v1/pdf/extract: reads a CIPC PDF with pdf.js (src/lib/cipc/pdf.ts).
// - POST /v1/share-card: draws a link-preview card (src/lib/sharing/share-card.tsx)
//   with the Workers build of @vercel/og, exactly as the website did.
//
// The Worker has no public address (no routes, workers_dev and preview URLs
// off), so only Workers bound to it can call it. It holds no secrets and reads
// no data: everything it needs arrives in the request.
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.edge.js";
import { extractPdf } from "../src/lib/cipc/pdf";
import {
  OFFLOAD_MAX_PDF_BYTES,
  OFFLOAD_PDF_PATH,
  OFFLOAD_SHARE_CARD_PATH,
} from "../src/lib/offload/protocol";
import { parseShareCardInput, renderShareCardPng } from "../src/lib/sharing/share-card";

const MAX_CARD_REQUEST_BYTES = 8 * 1024;

function reply(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** The request body, or null when it is larger than `limit` bytes. */
async function boundedBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname !== OFFLOAD_PDF_PATH && pathname !== OFFLOAD_SHARE_CARD_PATH)
    return reply(404, "Not found");
  if (request.method !== "POST") return reply(405, "Method not allowed");

  if (pathname === OFFLOAD_PDF_PATH) {
    const bytes = await boundedBody(request, OFFLOAD_MAX_PDF_BYTES);
    if (!bytes) return reply(413, "Too large");
    const result = await extractPdf(bytes);
    return new Response(JSON.stringify({ result }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const body = await boundedBody(request, MAX_CARD_REQUEST_BYTES);
  if (!body) return reply(413, "Too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return reply(400, "Bad request");
  }
  const input = parseShareCardInput(parsed);
  if (!input) return reply(400, "Bad request");
  const png = await renderShareCardPng(ImageResponse, input);
  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}

const offloadWorker = {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handle(request);
    } catch (error) {
      console.error("offload request failed", error instanceof Error ? error.message : error);
      return reply(500, "Offload failed");
    }
  },
};

export default offloadWorker;

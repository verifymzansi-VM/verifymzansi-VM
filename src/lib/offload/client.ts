// Heavy server-only work, kept out of the main Worker so it stays well under
// Cloudflare's 10 MB size limit (M9.9): reading CIPC PDFs (pdf.js) and drawing
// link-preview cards (@vercel/og with its WebAssembly).
//
// On Cloudflare the website hands this work to the offload Worker through
// the OFFLOAD service binding (wrangler.toml, workers/offload.ts), which runs
// the very same code. Everywhere else (local development, tests, the Node
// server for browser tests) it runs in this process.
import type { ExtractedPdf } from "@/lib/cipc/pdf";
import type { ShareCardInput } from "@/lib/sharing/share-card";
import { OFFLOAD_ORIGIN, OFFLOAD_PDF_PATH, OFFLOAD_SHARE_CARD_PATH } from "@/lib/offload/protocol";
import { extractPdfHere, renderShareCardHere } from "@/lib/offload/local";

/** The offload Worker is missing or did not answer; try again later. */
export class OffloadUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffloadUnavailableError";
  }
}

type OffloadBinding = { fetch(input: string, init?: RequestInit): Promise<Response> };

function isBinding(value: unknown): value is OffloadBinding {
  return !!value && typeof (value as { fetch?: unknown }).fetch === "function";
}

/**
 * Whether this code runs in a Cloudflare Worker. In Node (local development,
 * tests, the browser-test server) OpenNext still offers a Cloudflare context
 * through wrangler's local proxies, whose OFFLOAD service has no local Worker
 * behind it, so the context alone does not tell the two apart.
 */
function inWorker(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/** The OFFLOAD binding inside a Worker; null outside one (Node). */
async function offloadBinding(): Promise<OffloadBinding | null> {
  if (!inWorker()) return null;
  let environment: Record<string, unknown>;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    environment = (await getCloudflareContext({ async: true })).env as Record<string, unknown>;
  } catch (error) {
    throw new OffloadUnavailableError(
      `Worker context unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isBinding(environment.OFFLOAD)) {
    throw new OffloadUnavailableError("Worker offload binding is missing");
  }
  return environment.OFFLOAD;
}

async function call(binding: OffloadBinding, path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await binding.fetch(`${OFFLOAD_ORIGIN}${path}`, { method: "POST", ...init });
  } catch (error) {
    throw new OffloadUnavailableError(
      `Offload Worker unreachable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new OffloadUnavailableError(`Offload Worker answered ${response.status}`);
  }
  return response;
}

function isExtractedPdf(value: unknown): value is ExtractedPdf {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ExtractedPdf>;
  return Array.isArray(result.items) && !!result.structure && typeof result.structure === "object";
}

/**
 * Positioned text and file metadata from a PDF (see extractPdf). Null when
 * the bytes cannot be opened as a PDF. Throws OffloadUnavailableError when
 * the offload Worker cannot be reached, so an upload is never screened
 * without its PDF checks.
 */
export async function readPdf(bytes: Uint8Array): Promise<ExtractedPdf | null> {
  const binding = await offloadBinding();
  if (!binding) return extractPdfHere(bytes);
  const response = await call(binding, OFFLOAD_PDF_PATH, {
    headers: { "Content-Type": "application/pdf" },
    body: new Uint8Array(bytes),
  });
  const reply: unknown = await response.json().catch(() => null);
  if (!reply || typeof reply !== "object" || !("result" in reply))
    throw new OffloadUnavailableError("Malformed PDF reply");
  if (reply.result === null) return null;
  if (!isExtractedPdf(reply.result)) throw new OffloadUnavailableError("Malformed PDF reply");
  return reply.result;
}

/** The 1200 x 630 link-preview PNG for a post. */
export async function renderShareCard(input: ShareCardInput): Promise<ArrayBuffer> {
  const binding = await offloadBinding();
  if (!binding) return renderShareCardHere(input);
  const response = await call(binding, OFFLOAD_SHARE_CARD_PATH, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.headers.get("Content-Type") !== "image/png") {
    await response.body?.cancel();
    throw new OffloadUnavailableError("Malformed share card reply");
  }
  return response.arrayBuffer();
}

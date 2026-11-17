// Heavy work done in this process: local development, tests, CI and the Node
// server used by the browser tests. The Cloudflare build replaces this file
// with ./local.worker.ts (next.config.js), so PDF reading (pdf.js) and image
// drawing (@vercel/og with its WebAssembly) stay out of the main Worker. The
// deployed site does this work in the offload Worker instead.
import type { ExtractedPdf } from "@/lib/cipc/pdf";
import type { ShareCardInput } from "@/lib/sharing/share-card";

export async function extractPdfHere(bytes: Uint8Array): Promise<ExtractedPdf | null> {
  const { extractPdf } = await import("@/lib/cipc/pdf");
  return extractPdf(bytes);
}

export async function renderShareCardHere(input: ShareCardInput): Promise<ArrayBuffer> {
  const [{ ImageResponse }, { renderShareCardPng }] = await Promise.all([
    import("next/og"),
    import("@/lib/sharing/share-card"),
  ]);
  return renderShareCardPng(ImageResponse, input);
}

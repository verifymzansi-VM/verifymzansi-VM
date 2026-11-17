// Stand-in for ./local.ts in the Cloudflare build (next.config.js). The main
// Worker never does this work itself: it asks the offload Worker.
import type { ExtractedPdf } from "@/lib/cipc/pdf";
import type { ShareCardInput } from "@/lib/sharing/share-card";

export async function extractPdfHere(_bytes: Uint8Array): Promise<ExtractedPdf | null> {
  throw new Error("PDF reading runs in the offload Worker in this build");
}

export async function renderShareCardHere(_input: ShareCardInput): Promise<ArrayBuffer> {
  throw new Error("Share cards are drawn by the offload Worker in this build");
}

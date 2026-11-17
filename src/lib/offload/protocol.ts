// Requests the website sends to the offload Worker (workers/offload.ts) over
// the OFFLOAD service binding. The binding is private: the offload Worker has
// no public address, so only Workers bound to it can call these paths.

/** Body: the PDF bytes. Reply: JSON `{ result: ExtractedPdf | null }`. */
export const OFFLOAD_PDF_PATH = "/v1/pdf/extract";
/** Body: JSON ShareCardInput. Reply: the PNG. */
export const OFFLOAD_SHARE_CARD_PATH = "/v1/share-card";
/** Only the host part of the URL; service bindings never leave Cloudflare. */
export const OFFLOAD_ORIGIN = "https://offload.internal";
/** Largest PDF the website accepts (CIPC uploads are at most 5 MB). */
export const OFFLOAD_MAX_PDF_BYTES = 5 * 1024 * 1024;

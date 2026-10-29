import "server-only";
import { createHash } from "node:crypto";
import first from "./terms-documents/posting-v1.json";
import second from "./terms-documents/posting-v2.json";
import manifest from "./terms-documents/catalogue.json";
import type { FoundationPostingTerms } from "@/lib/foundation/posting-terms";

const catalogue = {
  "posting-v1": { document: first, document_hash: manifest.versions["posting-v1"] },
  "posting-v2": { document: second, document_hash: manifest.versions["posting-v2"] },
} as const;

/** Archived versions are pinned independently of the current Terms page.
 * A changed document needs a new version; it cannot inherit old acceptance. */
export function getPublishedPostingTerms(version: string) {
  if (!Object.hasOwn(catalogue, version)) return null;
  const entry = catalogue[version as keyof typeof catalogue];
  if (
    entry.document.version !== version ||
    createHash("sha256").update(JSON.stringify(entry.document)).digest("base64url") !==
      entry.document_hash
  )
    throw new Error("Published posting terms integrity check failed");
  return { ...structuredClone(entry.document), document_hash: entry.document_hash };
}

export function assertPublishedPostingTerms(document: FoundationPostingTerms) {
  const known = getPublishedPostingTerms(document.version);
  if (
    !known ||
    known.document_hash !== document.document_hash ||
    document.document_path !== `/terms/versions/${known.version}`
  )
    throw new Error("Published posting terms do not match the current policy");
}

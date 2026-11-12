import "server-only";
import { createHash } from "node:crypto";
import first from "./terms-documents/posting-v1.json";
import second from "./terms-documents/posting-v2.json";
import third from "./terms-documents/posting-v3.json";
import fourth from "./terms-documents/posting-v4.json";
import manifest from "./terms-documents/catalogue.json";
import type { FoundationPostingTerms } from "@/lib/foundation/posting-terms";

const catalogue = {
  "posting-v1": { document: first, document_hash: manifest.versions["posting-v1"] },
  "posting-v2": { document: second, document_hash: manifest.versions["posting-v2"] },
  "posting-v3": { document: third, document_hash: manifest.versions["posting-v3"] },
  "posting-v4": { document: fourth, document_hash: manifest.versions["posting-v4"] },
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

/** A version listed after the catalogue's active one is published ahead of
 * time: it comes into force only when a reviewed database update makes it
 * current, together with the release that names it active. */
export function isUpcomingPostingTermsVersion(version: string) {
  const order = Object.keys(manifest.versions);
  return order.indexOf(version) > order.indexOf(manifest.active_version);
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

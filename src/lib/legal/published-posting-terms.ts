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

type PostingTermsCatalogue = { active_version: string; versions: Record<string, string> };

/** Whether a published version is still waiting to come into force. The
 * database decides: a version listed after the one it holds as current (in
 * catalogue order) is not in force yet, whatever this release names active, so
 * a release deployed before its database update cannot present new terms as
 * in force. When the database's current version is unknown (it cannot be read,
 * or this release does not list it), the newest version and any version after
 * this release's active one count as not in force. */
export function postingTermsAwaitingForce(
  version: string,
  databaseCurrent: string | null,
  catalogue: PostingTermsCatalogue = manifest
) {
  const order = Object.keys(catalogue.versions);
  const index = order.indexOf(version);
  if (index === -1) return false;
  const current = databaseCurrent === null ? -1 : order.indexOf(databaseCurrent);
  if (current !== -1) return index > current;
  return index > order.indexOf(catalogue.active_version) || index === order.length - 1;
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

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertFixturePath } from "./foundation-native-paths.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");
export function readPostingTermsCatalogue() {
  const root = process.cwd(),
    prefix = "src/lib/legal/terms-documents/";
  const paths = {};
  const read = (file) => {
    assertFixturePath(root, file, { type: "file" });
    const bytes = readFileSync(file);
    assert.ok(bytes.length < 131072);
    paths[file] = hash(bytes);
    return JSON.parse(bytes);
  };
  const manifest = read(prefix + "catalogue.json");
  assert.deepEqual(Object.keys(manifest).sort(), ["active_version", "versions"]);
  assert.ok(Object.hasOwn(manifest.versions, manifest.active_version));
  const documents = [];
  for (const [version, digest] of Object.entries(manifest.versions)) {
    assert.match(version, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.match(digest, /^[A-Za-z0-9_-]{43}$/);
    const document = read(prefix + version + ".json");
    assert.equal(document.version, version);
    assert.equal(hash(JSON.stringify(document)), digest);
    assert.equal(document.privacy_path, "/privacy");
    assert.equal(document.company_details_path, "/terms#about-us");
    assert.ok(Array.isArray(document.sections) && document.sections.length > 0);
    documents.push({ version, document_hash: digest });
  }
  const sql =
    documents
      .map(
        (document) =>
          `insert into private.posting_terms_versions(version,document_hash) values('${document.version}','${document.document_hash}');`
      )
      .join("\n") +
    `\ninsert into private.posting_terms_current(version) values('${manifest.active_version}');\n`;
  return { activeVersion: manifest.active_version, documents, sourceHashes: paths, sql };
}

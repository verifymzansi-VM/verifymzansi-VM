import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { assertFixturePath } from "./foundation-native-paths.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");
function readPostingTermsCatalogue() {
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

const SET_CURRENT = "update private.posting_terms_current set version='";

/**
 * The clean baseline seeds the catalogue recorded in assembly.json when it was
 * built. Versions published since then reach the database through reviewed
 * files in database/foundation/updates. This checks that every recorded
 * version document is unchanged (published terms are never rewritten), that
 * each later version is inserted by an update with its catalogue hash, and that
 * the catalogue's active version is the one the last update makes current. It
 * returns the recorded baseline catalogue.
 * @param {ReturnType<typeof readPostingTermsCatalogue>} recorded
 * @param {string} updatesSql
 * @returns {ReturnType<typeof readPostingTermsCatalogue>}
 */
export function assertPostingTermsCatalogueSinceBaseline(recorded, updatesSql) {
  const current = readPostingTermsCatalogue();
  for (const document of recorded.documents)
    assert.deepEqual(
      current.documents.find((entry) => entry.version === document.version),
      document,
      `Published posting terms changed: ${document.version}`
    );
  for (const [file, digest] of Object.entries(recorded.sourceHashes))
    if (!file.endsWith("/catalogue.json"))
      assert.equal(
        current.sourceHashes[file],
        digest,
        `Published posting terms rewritten: ${file}`
      );
  const recordedVersions = new Set(recorded.documents.map((document) => document.version));
  for (const document of current.documents)
    if (!recordedVersions.has(document.version))
      assert.ok(
        updatesSql.includes(`values('${document.version}','${document.document_hash}')`),
        `Posting terms ${document.version} is not published by a database update`
      );
  const last = updatesSql.lastIndexOf(SET_CURRENT);
  const madeCurrent =
    last === -1
      ? recorded.activeVersion
      : updatesSql.slice(
          last + SET_CURRENT.length,
          updatesSql.indexOf("'", last + SET_CURRENT.length)
        );
  assert.equal(
    current.activeVersion,
    madeCurrent,
    "The active posting terms differ from the version the database updates make current"
  );
  return recorded;
}

/** All reviewed database updates, in the order the replay applies them. */
export function readFoundationUpdatesSql() {
  const folder = "database/foundation/updates";
  return readdirSync(folder)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      assertFixturePath(process.cwd(), `${folder}/${name}`, { type: "file" });
      return readFileSync(`${folder}/${name}`, "utf8");
    })
    .join("\n");
}

/** The catalogue the clean baseline (candidate.sql) seeds, after checking that
 * the shipped catalogue only extends it through reviewed database updates. */
export function readBaselinePostingTermsCatalogue() {
  const file = "database/foundation/assembly.json";
  assertFixturePath(process.cwd(), file, { type: "file" });
  return assertPostingTermsCatalogueSinceBaseline(
    JSON.parse(readFileSync(file, "utf8")).postingTermsCatalogue,
    readFoundationUpdatesSql()
  );
}

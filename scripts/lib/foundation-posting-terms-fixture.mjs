import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Synthetic documents only. Never seed these into a hosted project.
export const FIXTURE_POSTING_TERMS = Object.freeze({
  version: "fixture-posting-v1",
  document_hash: createHash("sha256")
    .update("Synthetic fixture posting terms v1")
    .digest("base64url"),
});
export const NEXT_FIXTURE_POSTING_TERMS = Object.freeze({
  version: "fixture-posting-v2",
  document_hash: createHash("sha256")
    .update("Synthetic fixture posting terms v2")
    .digest("base64url"),
});

export function installFixturePostingTerms(sql) {
  assert.equal(sql("select count(*) from private.posting_terms_versions;"), "0");
  assert.equal(sql("select count(*) from private.posting_terms_current;"), "0");
  sql(`insert into private.posting_terms_versions(version,document_hash)
    values('${FIXTURE_POSTING_TERMS.version}','${FIXTURE_POSTING_TERMS.document_hash}');
    insert into private.posting_terms_current(version) values('${FIXTURE_POSTING_TERMS.version}');`);
  return () => {
    assert.equal(sql("select count(*) from auth.users;"), "0");
    assert.equal(
      sql(`select count(*) from private.posting_terms_versions
      where version not in('${FIXTURE_POSTING_TERMS.version}','${NEXT_FIXTURE_POSTING_TERMS.version}');`),
      "0"
    );
    sql(`begin;
      delete from private.posting_terms_current;
      alter table private.posting_terms_versions disable trigger posting_terms_document_immutable;
      delete from private.posting_terms_versions where version in
        ('${FIXTURE_POSTING_TERMS.version}','${NEXT_FIXTURE_POSTING_TERMS.version}');
      alter table private.posting_terms_versions enable trigger posting_terms_document_immutable;
      commit;`);
    assert.equal(sql("select count(*) from private.posting_terms_acceptances;"), "0");
  };
}

/** Explicit synthetic caller consent via the real authenticated API, never an
 * Auth creation default or privileged insertion of an acceptance fact. */
export async function acceptFixturePostingTerms(member, document = FIXTURE_POSTING_TERMS) {
  const result = await member.schema("api").rpc("accept_posting_terms", {
    p_version: document.version,
    p_document_hash: document.document_hash,
  });
  assert.equal(result.error, null, "Synthetic caller posting terms acceptance");
  assert.equal(result.data.version, document.version);
  assert.equal(result.data.document_hash, document.document_hash);
  return result.data;
}

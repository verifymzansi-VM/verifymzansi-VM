import assert from "node:assert/strict";

/** The caller already verified local fixture identity and acquired its lock.
 * Drop only the temporary database whose creation returned the recorded OID.
 * An uncertain creation outcome is inspected and retained, never guessed away.
 */
export function cleanupOwnedProbeDatabase({ sql, database, createdOid, creationAttempted }) {
  assert.ok(["foundation_activity_ddl_probe", "foundation_context_ddl_probe"].includes(database));
  if (createdOid) {
    assert.match(createdOid, /^[1-9][0-9]*$/);
    assert.equal(sql(`select oid from pg_database where datname='${database}';`), createdOid);
    sql(`drop database ${database};`);
    assert.equal(sql(`select count(*) from pg_database where datname='${database}';`), "0");
    return "PASS owned temporary database removed";
  }
  if (creationAttempted) {
    assert.equal(sql(`select count(*) from pg_database where datname='${database}';`), "0");
    return "PASS no database created";
  }
  return "NOT_CREATED";
}

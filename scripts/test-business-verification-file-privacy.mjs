// Regression proof of the direct SELECT bypass and its service-only fix.
// Runs PostgreSQL locally in memory; never reads hosted evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (name) => fs.readFileSync(`supabase/migrations/${name}`, "utf8");
const definition = read("20261006124457_business_verifications.sql").match(
  /CREATE TABLE public\.business_verification_files \([\s\S]*?\n\);/
)?.[0];
assert(definition, "actual verification file definition is present");
const migration = read("20261013120249_service_only_business_verification_files.sql");
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.business_verifications (id uuid PRIMARY KEY);
    ${definition}
    ALTER TABLE public.business_verification_files ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON public.business_verification_files TO service_role;
    GRANT SELECT ON public.business_verification_files TO authenticated;
    -- Simulate a future column plus legacy PUBLIC/column grants. Table-only
    -- revocation would leave these alternate SELECT paths open.
    ALTER TABLE public.business_verification_files ADD COLUMN "future evidence" text;
    GRANT SELECT (id,extracted_text,"future evidence") ON public.business_verification_files TO PUBLIC, anon, authenticated;
    -- A permissive staff policy stands in for an eligible active AAL2 staff
    -- session: its RLS access cannot enforce the HTTP route's per-file gates.
    CREATE POLICY eligible_staff ON public.business_verification_files FOR SELECT TO authenticated USING (true);
    INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001');
    INSERT INTO public.business_verifications VALUES ('00000000-0000-0000-0000-000000000002');
    INSERT INTO public.business_verification_files (case_id,kind,uploaded_by,r2_key,content_type,size_bytes,sha256,quarantined,extracted_text,purge_after)
      VALUES ('00000000-0000-0000-0000-000000000002','owner_upload','00000000-0000-0000-0000-000000000001',
        'synthetic-key','application/pdf',1,'synthetic-hash',true,'synthetic expired evidence',now() - interval '1 day');
    SET ROLE authenticated;
  `);
  assert.equal(
    (await db.query("SELECT extracted_text FROM public.business_verification_files")).rows[0]
      .extracted_text,
    "synthetic expired evidence",
    "reproduce staff direct-read bypass before migration"
  );
  await db.exec(`RESET ROLE; ${migration}`);

  const columns = (
    await db.query(
      `SELECT attname FROM pg_attribute WHERE attrelid='public.business_verification_files'::regclass AND attnum>0 AND NOT attisdropped`
    )
  ).rows.map((r) => r.attname);
  for (const role of ["anon", "authenticated"]) {
    assert.equal(
      (
        await db.query(
          `SELECT has_table_privilege($1,'public.business_verification_files','SELECT') AS allowed`,
          [role]
        )
      ).rows[0].allowed,
      false
    );
    for (const column of columns) {
      assert.equal(
        (
          await db.query(
            `SELECT has_column_privilege($1,'public.business_verification_files',$2,'SELECT') AS allowed`,
            [role, column]
          )
        ).rows[0].allowed,
        false,
        `${role}.${column}`
      );
    }
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(
      db.query("SELECT * FROM public.business_verification_files"),
      /permission denied/
    );
    await assert.rejects(
      db.query("SELECT extracted_text FROM public.business_verification_files"),
      /permission denied/
    );
    await assert.rejects(
      db.query('SELECT "future evidence" FROM public.business_verification_files'),
      /permission denied/
    );
    await db.exec("RESET ROLE");
  }
  // PUBLIC grants are represented by grantee oid 0 at table and column level.
  assert.equal(
    (
      await db.query(`SELECT count(*)::int AS grants FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid='public.business_verification_files'::regclass AND a.grantee=0 AND a.privilege_type='SELECT'`)
    ).rows[0].grants,
    0
  );
  assert.equal(
    (
      await db.query(`SELECT count(*)::int AS grants FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
    WHERE c.attrelid='public.business_verification_files'::regclass AND a.grantee=0 AND a.privilege_type='SELECT'`)
    ).rows[0].grants,
    0
  );
  assert.equal(
    (
      await db.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid='public.business_verification_files'::regclass`
      )
    ).rows[0].relrowsecurity,
    true
  );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int AS policies FROM pg_policy WHERE polrelid='public.business_verification_files'::regclass`
      )
    ).rows[0].policies,
    1
  );
  await db.exec("SET ROLE service_role");
  assert.equal(
    (await db.query("SELECT extracted_text FROM public.business_verification_files")).rows[0]
      .extracted_text,
    "synthetic expired evidence"
  );
  await db.query("UPDATE public.business_verification_files SET producer='server' RETURNING id");
  assert.equal(
    (await db.query("DELETE FROM public.business_verification_files RETURNING id")).rows.length,
    1,
    "existing service mutations remain allowed"
  );
  await db.exec(`RESET ROLE; ${migration}`);
  console.log(
    "Business verification evidence PostgreSQL checks passed (pre-fix bypass, table/column/PUBLIC denials, service access, RLS preservation, idempotence)."
  );
} finally {
  await db.close();
}

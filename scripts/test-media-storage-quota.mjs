// Isolated PostgreSQL accounting checks. No environment files or remote writes.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const mb = 1048576;
const migration = fs.readFileSync(
  "supabase/migrations/20260930234207_atomic_media_storage_quota.sql",
  "utf8"
);
const read = (name) => fs.readFileSync(`supabase/migrations/${name}`, "utf8");
let counter = 0;
const insert = async (user, bytes) =>
  db.query(
    "INSERT INTO public.media_uploads(user_id,r2_key,url,file_size) VALUES ($1,$2,$2,$3) RETURNING id",
    [user, `test-${++counter}`, bytes]
  );
const used = async (user) =>
  (await db.query("SELECT public.media_storage_used($1) AS used", [user])).rows[0].used;
const rejects = (action, code) => assert.rejects(action, (error) => error.code === code);

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;`);
  await db.exec(read("20231231000000_api_role_defaults.sql"));
  await db.exec(read("20260321000000_media_uploads_tracking.sql"));
  await db.exec(read("20260724000000_media_uploads_validated_at.sql"));
  await db.exec(read("20260913090000_media_uploads_server_writes.sql"));
  await db.exec(`CREATE TABLE public.commercial_settings(key text PRIMARY KEY,value jsonb NOT NULL);
    INSERT INTO public.commercial_settings VALUES ('media','{"storageQuotaMb":50}');`);
  await db.query("INSERT INTO auth.users VALUES ($1),($2)", [owner, other]);
  await insert(owner, 30 * mb); // legacy rows, including unvalidated uploads, are counted.
  await db.exec(migration);
  await db.exec(migration);
  assert.equal(await used(owner), 30 * mb);
  assert.equal(await used(other), 0);

  // Both requests saw the same allowance before either tracking write.
  const firstPreflight = await used(owner),
    secondPreflight = await used(owner);
  assert(firstPreflight + 20 * mb <= 50 * mb && secondPreflight + 20 * mb <= 50 * mb);
  const accepted = await insert(owner, 20 * mb);
  await rejects(insert(owner, 20 * mb), "PT413");
  assert.equal(await used(owner), 50 * mb);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM media_uploads WHERE user_id=$1", [owner]))
      .rows[0].n,
    2
  );

  await insert(other, 50 * mb); // independent account allowance.
  await rejects(insert(other, 1), "PT413");
  await rejects(
    db.query("UPDATE media_uploads SET file_size=file_size+1 WHERE id=$1", [accepted.rows[0].id]),
    "PT413"
  );
  await db.query("UPDATE media_uploads SET file_size=file_size-10 WHERE id=$1", [
    accepted.rows[0].id,
  ]);
  assert.equal(await used(owner), 50 * mb - 10);
  await rejects(
    db.query("UPDATE media_uploads SET user_id=$1 WHERE id=$2", [other, accepted.rows[0].id]),
    "22023"
  );
  await rejects(insert(owner, -1), "22023");

  // PostgreSQL retains decimal notation; the application accepts integer-valued numbers.
  for (const numericLiteral of ["50.0", "5e1"]) {
    await db.query("UPDATE commercial_settings SET value=$1::jsonb WHERE key='media'", [
      `{"storageQuotaMb":${numericLiteral}}`,
    ]);
    const decimalUpload = await insert(owner, 1);
    await db.query("DELETE FROM media_uploads WHERE id=$1", [decimalUpload.rows[0].id]);
    assert.equal(await used(owner), 50 * mb - 10);
  }

  // Invalid settings stop growth, while deletion/size reduction still work.
  for (const value of [null, "50", -1, 1.5, 100001, 99999999999999999999999999]) {
    await db.query("UPDATE commercial_settings SET value=$1::jsonb WHERE key='media'", [
      JSON.stringify({ storageQuotaMb: value }),
    ]);
    await rejects(insert(owner, 1), "PT503");
  }
  await db.query("DELETE FROM media_uploads WHERE id=$1", [accepted.rows[0].id]);
  assert.equal(await used(owner), 30 * mb);
  await db.exec("DELETE FROM commercial_settings"); // documented 500 MB default.
  const defaultUpload = await insert(owner, 50 * mb);
  assert.equal(await used(owner), 80 * mb);
  await db.exec("INSERT INTO commercial_settings VALUES ('media','{\"storageQuotaMb\":50}')");
  await rejects(insert(owner, 1), "PT413"); // a lowered quota preserves existing files.
  await db.query("DELETE FROM media_uploads WHERE id=$1", [defaultUpload.rows[0].id]);

  // A later error rolls back accounting together with tracking.
  await db.exec("BEGIN");
  await insert(owner, 1);
  await db.exec("ROLLBACK");
  assert.equal(await used(owner), 30 * mb);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    try {
      await rejects(db.query("SELECT * FROM public.media_storage_usage"), "42501");
      await rejects(db.query("SELECT public.media_storage_used($1)", [owner]), "42501");
      await rejects(insert(owner, 1), "42501");
    } finally {
      await db.exec("RESET ROLE");
    }
  }
  await db.exec("SET ROLE service_role");
  try {
    assert.equal(await used(owner), 30 * mb);
    await rejects(db.exec("UPDATE public.media_storage_usage SET used_bytes=0"), "42501");
    await insert(owner, 1); // trusted uploads still invoke the private trigger.
  } finally {
    await db.exec("RESET ROLE");
  }
  await db.query("DELETE FROM auth.users WHERE id=$1", [owner]);
  assert.equal(await used(owner), 0);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM media_storage_usage WHERE user_id=$1", [owner]))
      .rows[0].n,
    0
  );
  process.stdout.write(
    "Media quota checks passed: stale preflight rejected, exact boundary, pending rows, per-account isolation, update/delete/cascade accounting, rollback, settings failures and role restrictions (PGlite; not multi-session PostgreSQL).\n"
  );
} finally {
  await db.close();
}

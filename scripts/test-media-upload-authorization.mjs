// In-memory PostgreSQL role checks. No environment files, sockets or remote data.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const victim = "22222222-2222-4222-8222-222222222222";
const readMigration = (name) => fs.readFileSync(`supabase/migrations/${name}`, "utf8");
const insert = `INSERT INTO public.media_uploads
  (user_id,r2_key,bucket,url,created_at,validated_at) VALUES
  ($1,$2,$3,$4,now()-interval '2 days',now()) RETURNING id`;

async function asRole(role, userId, action) {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [userId]);
    return await action();
  } finally {
    await db.exec("RESET ROLE");
  }
}

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT jsonb_build_object('role',current_user) $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;`);
  await db.exec(readMigration("20231231000000_api_role_defaults.sql"));
  await db.exec(readMigration("20260321000000_media_uploads_tracking.sql"));
  await db.exec(readMigration("20260724000000_media_uploads_validated_at.sql"));
  const policies = readMigration("20260524061149_fix_performance_advisor_findings.sql");
  const mediaPolicies = policies.slice(
    policies.indexOf("DROP POLICY IF EXISTS media_uploads_select"),
    policies.indexOf('DROP POLICY IF EXISTS "Owner reads own content edit requests"')
  );
  assert(mediaPolicies.includes("CREATE POLICY media_uploads_insert"));
  await db.exec(mediaPolicies);
  await db.query("INSERT INTO auth.users VALUES ($1),($2)", [owner, victim]);

  // Reproduce both original bypasses: the owner can forge validation and an
  // aged tracking row pointing at somebody else's public media / private key.
  for (const bucket of ["public", "private"]) {
    const key = `media/listing/${victim}/victim.mp4`;
    await asRole("authenticated", owner, () =>
      db.query(insert, [owner, key, bucket, `https://media.example/${key}`])
    );
  }
  const exposed = await db.query(`SELECT count(*)::integer AS n FROM media_uploads
    WHERE confirmed_at IS NULL AND created_at < now()-interval '24 hours'
    AND validated_at IS NOT NULL`);
  assert.equal(exposed.rows[0].n, 2, "Old policies expose forged rows to attachment and cleanup");
  await db.exec("DELETE FROM media_uploads");

  const migration = readMigration("20260913090000_media_uploads_server_writes.sql");
  await db.exec(migration);
  await db.exec(migration); // Safe to reapply if the migration response is lost.

  for (const role of ["anon", "authenticated"]) {
    for (const userId of [owner, victim]) {
      await assert.rejects(
        asRole(role, owner, () => db.query(insert, [userId, "victim-key", "private", "https://media.example/victim-key"])),
        (error) => error.code === "42501",
        `${role} must not forge tracking for self or another account`
      );
    }
  }

  // Both real upload paths, validation and confirmation still work for the
  // server role; authenticated readers only see their own tracking records.
  const records = [];
  for (const userId of [owner, victim]) {
    const result = await asRole("service_role", "", () => db.query(
      `INSERT INTO media_uploads(user_id,r2_key,bucket,url) VALUES ($1,$2,'public',$3) RETURNING id`,
      [userId, `media/listing/${userId}/video.mp4`, `https://media.example/${userId}.mp4`]
    ));
    records.push(result.rows[0].id);
  }
  await asRole("service_role", "", () => db.query(
    "UPDATE media_uploads SET validated_at=now(),confirmed_at=now() WHERE id=$1", [records[0]]
  ));
  const visible = await asRole("authenticated", owner, () => db.query("SELECT id,validated_at,confirmed_at FROM media_uploads"));
  assert.equal(visible.rows.length, 1);
  assert.equal(visible.rows[0].id, records[0]);
  assert(visible.rows[0].validated_at && visible.rows[0].confirmed_at);
  const anonymous = await asRole("anon", "", () => db.query("SELECT id FROM media_uploads"));
  assert.equal(anonymous.rows.length, 0);
  for (const sql of ["UPDATE media_uploads SET validated_at=now()", "DELETE FROM media_uploads"]) {
    await assert.rejects(asRole("authenticated", owner, () => db.exec(sql)), (error) => error.code === "42501");
  }
  await asRole("service_role", "", () => db.exec("DELETE FROM media_uploads"));
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM media_uploads")).rows[0].n, 0);
  console.log("Media tracking authorization passed: original forgery reproduced; client writes denied; owner reads and service upload/cleanup writes preserved (isolated PGlite, not deployed PostgREST/R2).");
} finally {
  await db.close();
}

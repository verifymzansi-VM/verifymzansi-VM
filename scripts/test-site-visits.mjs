// PostgreSQL regression tests without external credentials or remote writes.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  for (const name of ["20260920120000_site_visits.sql", "20260920130000_site_visit_accuracy.sql"]) {
    await db.exec(fs.readFileSync(`supabase/migrations/${name}`, "utf8"));
  }
  const stats = async () =>
    (await db.query("SELECT public.get_site_visit_stats() AS stats")).rows[0].stats;
  const record = async (path, viewer = "anon:test") =>
    (await db.query("SELECT public.record_site_visit($1,NULL,$2,NULL) AS recorded", [path, viewer]))
      .rows[0].recorded;
  assert.equal((await stats()).daily.length, 14);
  for (const path of [
    "/verification",
    "/dashboard",
    "/billing",
    "/dsar",
    "/admin",
    "/api/x",
    "/login",
    "/post/create",
    "//example.com",
    "/mzansi-market/private",
    "/?token=secret",
  ]) {
    assert.equal(await record(path), false, path);
  }
  assert.equal(await record("/"), true);
  assert.equal(await record("/"), false);
  assert.equal(await record("/pricing"), true);
  await db.exec("TRUNCATE site_visits");
  await db.exec(`INSERT INTO site_visits(path, viewer_key, created_at)
    SELECT '/', 'anon:' || n, now() FROM generate_series(1,12400) n;
    INSERT INTO site_visits(path, viewer_key, created_at) VALUES
      ('/verification','internal',now()),
      ('/listing/11111111-1111-4111-8111-111111111111','detail',now()),
      ('/pricing','yesterday',date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg' - interval '1 second'),
      ('/pricing','seven-out', (date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '6 days') AT TIME ZONE 'Africa/Johannesburg' - interval '1 second'),
      ('/pricing','thirty-out', (date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '29 days') AT TIME ZONE 'Africa/Johannesburg' - interval '1 second');`);
  const result = await stats();
  assert.equal(result.visitsToday, 12401);
  assert.equal(result.uniqueVisitorsToday, 12401);
  assert.equal(result.visits7d, 12402);
  assert.equal(result.uniqueVisitors7d, 12402);
  assert.equal(result.visits30d, 12403);
  assert.equal(result.uniqueVisitors30d, 12403);
  assert.equal(result.daily.at(-1).visits, 12401);
  assert.equal(result.byArea.find((a) => a.area === "shared_listings").visits, 1);
  assert.equal(
    result.byArea.reduce((n, a) => n + a.visits, 0),
    result.visits30d
  );
  // Yesterday's last visit must not suppress a browser's first navigation today.
  assert.equal(await record("/pricing", "yesterday"), true);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(stats, /permission denied/);
    await assert.rejects(() => record("/"), /permission denied/);
    await assert.rejects(() => db.query("SELECT * FROM site_visits"), /permission denied/);
    await db.exec("RESET ROLE");
  }
  await db.exec("SET ROLE service_role");
  assert.equal((await stats()).visitsToday, 12402);
  console.log(
    "PASS: public scope, 12,400 visitors, SAST boundaries, historical filtering, area attribution, dedupe and role isolation"
  );
} finally {
  await db.close();
}

// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const migration = readFileSync(
  "supabase/migrations/20261008234338_optimize_traffic_queries_and_showroom_index.sql",
  "utf8"
);
const followupMigration = readFileSync(
  "supabase/migrations/20261008235202_reduce_traffic_classification_and_bound_views.sql",
  "utf8"
);
const first = "00000000-0000-4000-8000-000000000001";
const missing = "00000000-0000-4000-8000-000000000002";

function originalFunction(file: string, name: string) {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  const match = sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\bAS\\s+(\\$[\\w]*\\$)[\\s\\S]*?\\1;`,
      "i"
    )
  );
  if (!match) throw new Error(`Missing function ${name}`);
  return match[0];
}
const oldStats = originalFunction(
  "20261002135904_fair_showroom_rotation.sql",
  "get_site_visit_stats"
).replace("public.get_site_visit_stats()", "public.original_site_visit_stats()");
const oldCounts = originalFunction(
  "20261002135800_content_views_v2.sql",
  "get_content_view_counts"
).replace("public.get_content_view_counts(", "public.original_content_view_counts(");
const stats = (name = "get_site_visit_stats") =>
  db.query<{ stats: Record<string, unknown> }>(`SELECT public.${name}() AS stats`);

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.staff_roles(user_id UUID PRIMARY KEY, status TEXT);
    CREATE TABLE public.content_views(
      source TEXT NOT NULL CHECK (source IN ('video', 'page')),
      engaged BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE public.analytics_events(content_id UUID, event_type TEXT, surface TEXT, created_at TIMESTAMPTZ);
    CREATE TABLE public.listings(id UUID PRIMARY KEY, view_count BIGINT);
    CREATE TABLE public.businesses(LIKE public.listings INCLUDING ALL);
    CREATE TABLE public.promotions(LIKE public.listings INCLUDING ALL);
    INSERT INTO public.listings VALUES('${first}', 4294967296);
    INSERT INTO public.businesses VALUES('${first}', 7);
    INSERT INTO public.promotions VALUES('${first}', NULL);
  `);
  await db.exec(readFileSync("supabase/migrations/20260920120000_site_visits.sql", "utf8"));
  await db.exec(originalFunction("20261002135904_fair_showroom_rotation.sql", "site_visit_area"));
  await db.exec(oldStats + oldCounts);
  await db.exec("BEGIN;" + migration + followupMigration + "COMMIT;");
}, 30000);
afterAll(async () => db.close());

describe("Postgres traffic query optimization", () => {
  it("preserves the empty dashboard and all 14 zero-filled days", async () => {
    const result = (await stats()).rows[0].stats;
    expect(result).toEqual((await stats("original_site_visit_stats")).rows[0].stats);
    expect(result.daily).toHaveLength(14);
  });

  it("preserves distinct visitors, staff exclusion, public paths and SAST boundaries", async () => {
    await db.exec(`BEGIN;
      INSERT INTO staff_roles VALUES('${first}', 'active'), ('${missing}', 'inactive');
      INSERT INTO site_visits(path,viewer_key,user_id,created_at) VALUES
        ('/', 'staff', '${first}', now()),
        ('/', 'inactive-staff', '${missing}', now()),
        ('/dashboard', 'private', NULL, now()),
        ('/sponsors', 'sponsor', NULL, now()),
        ('/pricing', 'repeat', NULL, now()),
        ('/pricing', 'repeat', NULL, now()),
        ('/pricing', 'repeat', NULL, now() - interval '1 day'),
        ('/', 'future', NULL, now() + interval '1 day'),
        ('/', 'before-today', NULL, date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg' - interval '1 microsecond'),
        ('/', 'at-7d', NULL, (date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '6 days') AT TIME ZONE 'Africa/Johannesburg'),
        ('/', 'before-7d', NULL, (date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '6 days') AT TIME ZONE 'Africa/Johannesburg' - interval '1 microsecond'),
        ('/', 'at-30d', NULL, (date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '29 days') AT TIME ZONE 'Africa/Johannesburg'),
        ('/', 'before-30d', NULL, (date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '29 days') AT TIME ZONE 'Africa/Johannesburg' - interval '1 microsecond');
      INSERT INTO site_visits(path,viewer_key,created_at)
        SELECT '/', 'load:' || n, now() - ((n % 30) || ' days')::interval
        FROM generate_series(1,12400) n;
      INSERT INTO content_views
        SELECT CASE WHEN n % 2 = 0 THEN 'video' ELSE 'page' END, n % 3 = 0,
          now() - ((n % 31) || ' days')::interval FROM generate_series(1,2000) n;
    `);
    try {
      const result = (await stats()).rows[0].stats;
      expect(result).toEqual((await stats("original_site_visit_stats")).rows[0].stats);
      expect(result.daily).toHaveLength(14);
      expect(result.uniqueVisitorsToday).toBeLessThan(result.visitsToday as number);
    } finally {
      await db.exec("ROLLBACK;");
    }
  }, 30000);

  it("preserves every content type, duplicate/null/missing IDs, unknown types and bigint totals", async () => {
    for (const type of ["listing", "business", "promotion", "unknown", null]) {
      for (const ids of [[first, first, missing, null], [], null]) {
        const sql = (name: string) =>
          `SELECT * FROM public.${name}($1::uuid[],$2::text) ORDER BY target_id NULLS LAST`;
        const result = await db.query(sql("get_content_view_counts"), [ids, type]);
        const original = await db.query(sql("original_content_view_counts"), [ids, type]);
        expect(result.rows).toEqual(original.rows);
      }
    }
  });

  it("counts only elapsed visits and views with independently asserted SAST totals", async () => {
    await db.exec(`BEGIN;
      INSERT INTO staff_roles VALUES('${first}','active');
      INSERT INTO site_visits(path,viewer_key,user_id,created_at) VALUES
        ('/','repeat',NULL,now()), ('/pricing','repeat',NULL,now()),
        ('/sponsors','repeat',NULL,
          date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg' - interval '1 microsecond'),
        ('/','staff','${first}',now()), ('/dashboard','internal',NULL,now()),
        ('/','future',NULL,now()+interval '1 microsecond');
      INSERT INTO content_views(source,engaged,created_at) VALUES
        ('video',true,now()),
        ('page',false,date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg' - interval '1 microsecond'),
        ('video',false,(date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '6 days') AT TIME ZONE 'Africa/Johannesburg'),
        ('page',true,(date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '6 days') AT TIME ZONE 'Africa/Johannesburg' - interval '1 microsecond'),
        ('page',false,(date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '29 days') AT TIME ZONE 'Africa/Johannesburg'),
        ('video',true,(date_trunc('day',now() AT TIME ZONE 'Africa/Johannesburg') - interval '29 days') AT TIME ZONE 'Africa/Johannesburg' - interval '1 microsecond'),
        ('video',true,now()+interval '1 microsecond'),
        ('page',true,now()+interval '1 day');`);
    try {
      const result = (await stats()).rows[0].stats;
      expect(result).toMatchObject({
        visitsToday: 2,
        visits7d: 3,
        visits30d: 3,
        uniqueVisitorsToday: 1,
        uniqueVisitors7d: 1,
        uniqueVisitors30d: 1,
        postViewsToday: 1,
        postViews7d: 3,
        postViews30d: 5,
        videoViews7d: 2,
        engagedViews7d: 1,
      });
      const days = result.daily as Array<{ visits: number; visitors: number; postViews: number }>;
      expect(days).toHaveLength(14);
      expect(days.at(-1)).toMatchObject({ visits: 2, visitors: 1, postViews: 1 });
      expect(days.at(-2)).toMatchObject({ visits: 1, visitors: 1, postViews: 1 });
      expect(days.at(-3)).toMatchObject({ visits: 0, visitors: 0, postViews: 0 });
      // The inherited query included both future views; independent assertions catch that.
      expect((await stats("original_site_visit_stats")).rows[0].stats.postViews30d).toBe(7);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("classifies repeated visit paths once while retaining public-area attribution", async () => {
    await db.exec(`BEGIN;
      CREATE SEQUENCE public.test_area_calls;
      ${originalFunction("20261002135904_fair_showroom_rotation.sql", "site_visit_area").replace(
        "public.site_visit_area(",
        "public.original_site_visit_area("
      )}
      CREATE OR REPLACE FUNCTION public.site_visit_area(p_path TEXT)
      RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
      BEGIN
        PERFORM nextval('public.test_area_calls');
        RETURN public.original_site_visit_area(p_path);
      END $$;
      INSERT INTO site_visits(path,viewer_key,created_at)
        SELECT '/', 'repeated:' || n, now() FROM generate_series(1,2000) n;`);
    try {
      const result = (await stats()).rows[0].stats;
      expect(result.visitsToday).toBe(2000);
      expect(result.byArea).toEqual([{ area: "home", visits: 2000 }]);
      const calls = await db.query<{ last_value: number }>(
        "SELECT last_value FROM public.test_area_calls"
      );
      expect(calls.rows[0].last_value).toBe(1);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("preserves 1,000 real-ID counts under custom and generic prepared plans", async () => {
    await db.exec(`BEGIN;
      INSERT INTO listings SELECT md5(n::text)::uuid, n FROM generate_series(1,20000) n;
      ANALYZE listings;`);
    try {
      for (const mode of ["force_custom_plan", "force_generic_plan"]) {
        await db.exec(`SET LOCAL plan_cache_mode = ${mode};
          PREPARE count_batch(uuid[],text) AS SELECT * FROM get_content_view_counts($1,$2) ORDER BY target_id;`);
        const result = await db.query<{ correct: boolean }>(`
          WITH requested AS (SELECT array_agg(md5(n::text)::uuid) ids FROM generate_series(1,1000) n),
          actual AS (SELECT c.* FROM requested r CROSS JOIN LATERAL get_content_view_counts(r.ids,'listing') c)
          SELECT count(*) = 1000 AND sum(view_count) = 500500 AS correct FROM actual`);
        expect(result.rows[0].correct).toBe(true);
        const batch = await db.query<{ id: string }>(
          "SELECT md5(n::text)::uuid AS id FROM generate_series(1,1000) n"
        );
        const array = "ARRAY[" + batch.rows.map((row) => `'${row.id}'::uuid`).join(",") + "]";
        const prepared = await db.query(`EXECUTE count_batch(${array}, 'listing')`);
        expect(prepared.rows).toHaveLength(1000);
        expect(prepared.rows).toEqual(
          (
            await db.query(
              `SELECT * FROM original_content_view_counts(${array},'listing') ORDER BY target_id`
            )
          ).rows
        );
        await db.exec("DEALLOCATE count_batch");
      }
    } finally {
      await db.exec("ROLLBACK");
    }
  }, 30000);

  it("makes a covering index available for the showroom time-range query", async () => {
    await db.exec(`INSERT INTO analytics_events
      SELECT gen_random_uuid(),
        CASE WHEN n % 10 = 0 THEN 'showroom_appearance' ELSE 'detail_view' END,
        'showroom:home', now() - ((n % 30) || ' days')::interval
      FROM generate_series(1,20000) n;
      ANALYZE analytics_events;`);
    const result = await db.query(`EXPLAIN (FORMAT JSON)
      SELECT content_id,count(*) FROM analytics_events
      WHERE event_type='showroom_appearance' AND surface='showroom:home'
        AND created_at>now()-interval '7 days' GROUP BY content_id`);
    expect(JSON.stringify(result.rows)).toContain("idx_analytics_showroom_surface_created_cover");
  });

  it("denies direct RPC access to anon and authenticated and permits service_role", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(stats()).rejects.toThrow("permission denied");
        await expect(
          db.query("SELECT * FROM get_content_view_counts($1::uuid[],'listing')", [[first]])
        ).rejects.toThrow("permission denied");
      } finally {
        await db.exec("RESET ROLE");
      }
    }
    await db.exec("SET ROLE service_role");
    try {
      expect((await stats()).rows).toHaveLength(1);
      expect(
        (await db.query("SELECT * FROM get_content_view_counts($1::uuid[],'listing')", [[first]]))
          .rows
      ).toHaveLength(1);
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});

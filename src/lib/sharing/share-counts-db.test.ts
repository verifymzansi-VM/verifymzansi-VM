/** @vitest-environment node */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const id = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE TABLE auth.users(id UUID PRIMARY KEY);
    CREATE TABLE listings(id UUID PRIMARY KEY,status TEXT,expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE businesses(LIKE listings INCLUDING ALL); CREATE TABLE promotions(LIKE listings INCLUDING ALL);
    CREATE TABLE analytics_events(event_type TEXT CONSTRAINT analytics_events_event_type_check CHECK (event_type IN ('share')));
    INSERT INTO listings(id,status,expires_at) VALUES('${id}','live',now()+interval '1 day');
    INSERT INTO businesses(id,status,expires_at) VALUES('${id}','live',now()+interval '1 day');
    SET request.jwt.claim.role='service_role';`);
  await db.exec(
    readFileSync("supabase/migrations/20261003020000_content_share_counts.sql", "utf8")
  );
}, 30000);
afterAll(async () => {
  await db.close();
});

describe("durable share totals", () => {
  it("counts each viewer once, including repeated simultaneous requests", async () => {
    const record = (viewer: string) =>
      db.query<{ counted: boolean; share_count: number }>(
        "SELECT * FROM record_content_share($1,'listing',$2)",
        [id, viewer]
      );
    const results = await Promise.all([record("viewer-a"), record("viewer-a"), record("viewer-b")]);
    expect(results.map((result) => result.rows[0].counted)).toEqual([true, false, true]);
    expect(results[2].rows[0].share_count).toBe(2);
  });
  it("keeps identical UUIDs in different categories separate and returns zeros for new posts", async () => {
    await db.query("SELECT * FROM record_content_share($1,'business','viewer-a')", [id]);
    const result = await db.query<{ share_count: number }>(
      "SELECT * FROM get_content_share_counts(ARRAY[$1::uuid,$2::uuid],'business') ORDER BY target_id",
      [id, "00000000-0000-4000-8000-000000000002"]
    );
    expect(result.rows.map((row) => row.share_count)).toEqual([1, 0]);
  });
  it("rejects missing, draft and expired posts", async () => {
    await expect(
      db.query(
        "SELECT * FROM record_content_share('00000000-0000-4000-8000-000000000009','promotion','viewer-a')"
      )
    ).rejects.toThrow("Post unavailable");
    await db.query("UPDATE businesses SET status='draft' WHERE id=$1", [id]);
    await expect(
      db.query("SELECT * FROM record_content_share($1,'business','viewer-c')", [id])
    ).rejects.toThrow("Post unavailable");
    await db.query(
      "UPDATE businesses SET status='live',expires_at=now()-interval '1 day' WHERE id=$1",
      [id]
    );
    await expect(
      db.query("SELECT * FROM record_content_share($1,'business','viewer-c')", [id])
    ).rejects.toThrow("Post unavailable");
  });
  it("does not allow anonymous/authenticated direct writes or reads", async () => {
    await db.exec("SET ROLE authenticated; SET request.jwt.claim.role='authenticated';");
    try {
      await expect(db.query("SELECT * FROM content_shares")).rejects.toThrow("permission denied");
      await expect(
        db.query("SELECT * FROM record_content_share($1,'listing','forged')", [id])
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("RESET ROLE; SET request.jwt.claim.role='service_role';");
    }
  });
  it("removes an account's contribution on account deletion", async () => {
    const user = "00000000-0000-4000-8000-000000000005";
    await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.query("SELECT * FROM record_content_share($1,'listing','registered-hash',$2)", [
      id,
      user,
    ]);
    await db.query("DELETE FROM auth.users WHERE id=$1", [user]);
    const result = await db.query<{ n: number }>(
      "SELECT count(*) AS n FROM content_shares WHERE viewer_user_id=$1",
      [user]
    );
    expect(result.rows[0].n).toBe(0);
  });
  it("merges an anonymous browser into its signed-in account without inflating the total", async () => {
    const user = "00000000-0000-4000-8000-000000000006";
    await db.query("INSERT INTO auth.users VALUES($1)", [user]);
    await db.query("SELECT * FROM record_content_share($1,'listing','browser-c')", [id]);
    const before = await db.query<{ share_count: number }>(
      "SELECT * FROM get_content_share_counts(ARRAY[$1::uuid],'listing')",
      [id]
    );
    const after = await db.query<{ counted: boolean; share_count: number }>(
      "SELECT * FROM record_content_share($1,'listing','account-c',$2,'browser-c')",
      [id, user]
    );
    expect(after.rows[0].counted).toBe(false);
    expect(after.rows[0].share_count).toBe(before.rows[0].share_count);
  });
  it("rejects legacy posts whose introductory visibility expired", async () => {
    await db.query(
      "INSERT INTO promotions(id,status,expires_at,created_at) VALUES($1,'live',NULL,now()-interval '8 days')",
      [id]
    );
    await expect(
      db.query("SELECT * FROM record_content_share($1,'promotion','browser-z')", [id])
    ).rejects.toThrow("Post unavailable");
  });
});

// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SQL = readFileSync(
  "supabase/migrations/20261008182329_fix_supabase_security_review.sql",
  "utf8"
);
const OWNER = "00000000-0000-0000-0000-00000000000a";
const OTHER = "00000000-0000-0000-0000-00000000000b";
const db = new PGlite();
const query = (sql: string) => db.query<Record<string, unknown>>(sql);
function functionSql(file: string, name: string) {
  const migration = readFileSync(`supabase/migrations/${file}`, "utf8");
  return migration.match(
    new RegExp(
      `CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?\\bAS\\s+(\\$[\\w]*\\$)[\\s\\S]*?\\1;`,
      "i"
    )
  )![0];
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.has_role(text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
    CREATE TABLE public.feature_flags(key text PRIMARY KEY,mode text,enabled boolean,rollout_percent integer,updated_by uuid,updated_reason text);
    CREATE TABLE public.flag_audit(old_mode text,new_mode text);
    CREATE FUNCTION public.record_flag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.flag_audit VALUES(OLD.mode,NEW.mode); RETURN NEW; END $$;
    CREATE TRIGGER flag_changed AFTER UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.record_flag();
    INSERT INTO public.feature_flags VALUES('staff_mfa_enforced','off',true,100,NULL,NULL);
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO anon,authenticated,service_role;
  `);
  await db.exec(
    functionSql("20261007084543_no_edits_under_suspension.sql", "guard_owner_content_edits")
  );
  await db.exec(functionSql("20260906041522_introductory_trials.sql", "guard_post_funding_fields"));
  await db.exec(
    functionSql("20260724020000_write_path_hardening.sql", "guard_content_monetization_columns")
  );
  for (const table of ["listings", "businesses", "promotions"]) {
    await db.exec(`CREATE TABLE public.${table}(id integer PRIMARY KEY,owner_id uuid,status text,area text,created_at timestamptz,published_at timestamptz,expires_at timestamptz,featured boolean,urgent boolean,edited_since_review boolean DEFAULT false,entitlement_id uuid,status_reason text,title text,view_count integer DEFAULT 0,engaged_view_count integer DEFAULT 0);
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_read ON public.${table} FOR SELECT TO authenticated USING(owner_id=auth.uid());
      CREATE POLICY own_update ON public.${table} FOR UPDATE TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
      CREATE TRIGGER aa_guard_post_funding BEFORE UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.guard_post_funding_fields();
      CREATE TRIGGER guard_counter BEFORE UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.guard_content_monetization_columns();
      CREATE TRIGGER guard_owner_content_edits BEFORE UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.guard_owner_content_edits();
      INSERT INTO public.${table}(id,owner_id,status,title) SELECT row_number() OVER (), '${OWNER}'::uuid, s, 'Original' FROM unnest(ARRAY['draft','hidden','pending_moderation','rejected','live','suspended','flagged_for_review','sold','expired','archived']) s;
      INSERT INTO public.${table}(id,owner_id,status) VALUES(11,'${OTHER}','draft');`);
  }
  await db.exec(SQL);
});
afterAll(async () => db.close());
async function asRole(role: string, work: () => Promise<void>) {
  await db.exec(
    `SELECT set_config('request.jwt.claim.role','${role}',false),set_config('request.jwt.claim.sub','${OWNER}',false); SET ROLE ${role};`
  );
  try {
    await work();
  } finally {
    await db.exec("RESET ROLE");
  }
}
describe("Supabase security remediation", () => {
  it.each(["listings", "businesses", "promotions"])(
    "denies counter forgery across all owner states in %s",
    async (table) => {
      await asRole("authenticated", async () => {
        for (let id = 1; id <= 10; id++) {
          for (const counter of ["view_count", "engaged_view_count"]) {
            await expect(
              query(`UPDATE public.${table} SET ${counter}=1000000 WHERE id=${id}`)
            ).rejects.toMatchObject({ code: "42501" });
          }
        }
        expect(
          (
            await query(
              `UPDATE public.${table} SET engaged_view_count=1000000 WHERE id=11 RETURNING id`
            )
          ).rows
        ).toEqual([]);
        await query(`UPDATE public.${table} SET title='Allowed draft edit' WHERE id=1`);
        expect(
          (await query(`SELECT engaged_view_count FROM public.${table} WHERE id=1`)).rows[0]
            .engaged_view_count
        ).toBe(0);
      });
      await asRole("service_role", async () => {
        await query(
          `UPDATE public.${table} SET engaged_view_count=engaged_view_count+1 WHERE id=5`
        );
        expect(
          (await query(`SELECT engaged_view_count FROM public.${table} WHERE id=5`)).rows[0]
            .engaged_view_count
        ).toBe(1);
      });
    }
  );
  it("revokes whole-table privileges without dropping intended owner grants", async () => {
    const result = await query(
      `SELECT role,has_table_privilege(role,'public.listings','TRUNCATE') AS truncate,has_table_privilege(role,'public.listings','TRIGGER') AS trigger,has_table_privilege(role,'public.listings','REFERENCES') AS reference FROM unnest(ARRAY['anon','authenticated']) role`
    );
    expect(result.rows.every((r) => !r.truncate && !r.trigger && !r.reference)).toBe(true);
    expect(
      (
        await query(
          `SELECT has_table_privilege('authenticated','public.listings','UPDATE') AS update`
        )
      ).rows[0].update
    ).toBe(true);
  });
  it("requires explicit grants on future tables, columns, sequences and functions", async () => {
    await db.exec(`CREATE TABLE public.future_api_secret(id serial,secret text);
      CREATE FUNCTION public.future_privileged_rpc() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'private' $$;`);
    const result = await query(
      `SELECT role,has_table_privilege(role,'public.future_api_secret','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS table_access,has_any_column_privilege(role,'public.future_api_secret','SELECT,INSERT,UPDATE') AS column_access,has_sequence_privilege(role,'public.future_api_secret_id_seq','USAGE,SELECT,UPDATE') AS sequence_access,has_function_privilege(role,'public.future_privileged_rpc()','EXECUTE') AS rpc_access FROM unnest(ARRAY['anon','authenticated']) role`
    );
    expect(
      result.rows.every(
        (r) => !r.table_access && !r.column_access && !r.sequence_access && !r.rpc_access
      )
    ).toBe(true);
    expect(
      (
        await query(
          `SELECT has_function_privilege('anon','public.has_role(text)','EXECUTE') AS existing_helper`
        )
      ).rows[0].existing_helper
    ).toBe(true);
    await asRole("service_role", async () => {
      expect(
        (
          await query(
            "INSERT INTO public.future_api_secret(secret) VALUES ('service') RETURNING id"
          )
        ).rows
      ).toEqual([{ id: 1 }]);
      expect((await query("SELECT public.future_privileged_rpc() AS result")).rows).toEqual([
        { result: "private" },
      ]);
    });
  });
  it("enables the authoritative MFA flag mode and retains its audit trigger", async () => {
    expect(
      (
        await query(
          `SELECT mode,enabled,rollout_percent FROM public.feature_flags WHERE key='staff_mfa_enforced'`
        )
      ).rows[0]
    ).toEqual({ mode: "on", enabled: true, rollout_percent: 100 });
    expect((await query(`SELECT * FROM public.flag_audit`)).rows).toEqual([
      { old_mode: "off", new_mode: "on" },
    ]);
  });
});

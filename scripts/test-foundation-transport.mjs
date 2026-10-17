import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Always embedded, in-memory and synthetic. No .env or network clients.
const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const session = "00000000-0000-4000-8000-000000000003";
const resource = "00000000-0000-4000-8000-000000000004";
const job = "00000000-0000-4000-8000-000000000005";
const otherSession = "00000000-0000-4000-8000-000000000006";
const expiredSession = "00000000-0000-4000-8000-000000000007";

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.sessions (id uuid primary key, user_id uuid not null, not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync("docs/backend-foundation/prototypes/transport.sql", "utf8"));
  await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [session, owner]);
  await db.query("insert into auth.sessions (id, user_id) values ($1, $2)", [otherSession, other]);
  await db.query(
    "insert into auth.sessions (id, user_id, not_after) values ($1, $2, statement_timestamp() - interval '1 minute')",
    [expiredSession, owner]
  );
  await db.query(
    "insert into private.transport_resources (id, owner_id, title, private_note) values ($1, $2, 'Before', 'synthetic-private')",
    [resource, owner]
  );
  const asRole = async (role, claims, sql, params = []) => {
    await db.exec(`set role ${role}`); // role is a fixed test-owned enum, never runtime input.
    try {
      await db.query("select set_config('request.jwt.claims', $1, false)", [
        JSON.stringify(claims),
      ]);
      return await db.query(sql, params);
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims', '{}', false)");
    }
  };
  const claims = { role: "authenticated", sub: owner, session_id: session, is_anonymous: false };
  const rename = "select api.rename_transport_resource($1::uuid, $2::integer, $3::text) as result";
  for (const role of ["anon", "authenticated", "service_role"]) {
    await assert.rejects(
      asRole(role, { role }, "select * from private.transport_resources"),
      /permission denied/
    );
    await assert.rejects(
      asRole(role, { role }, "select * from private.transport_jobs"),
      /permission denied/
    );
  }
  for (const role of ["anon", "service_role"])
    await assert.rejects(
      asRole(role, { role }, rename, [resource, 1, "Denied"]),
      /permission denied/
    );
  const response = await asRole("authenticated", claims, rename, [resource, 1, "After"]);
  assert.deepEqual(response.rows[0].result, { id: resource, title: "After", revision: 2 });
  await assert.rejects(
    asRole("authenticated", { ...claims, sub: other, session_id: otherSession }, rename, [
      resource,
      2,
      "Cross-owner",
    ]),
    /resource unavailable/
  );
  await assert.rejects(
    asRole("authenticated", { ...claims, session_id: expiredSession }, rename, [
      resource,
      2,
      "Expired",
    ]),
    /live session required/
  );
  await db.exec(
    "revoke execute on function internal.rename_transport_resource(uuid, integer, text) from authenticated"
  );
  await assert.rejects(
    asRole("authenticated", claims, rename, [resource, 2, "Missing helper"]),
    /permission denied/
  );
  await db.exec(
    "grant execute on function internal.rename_transport_resource(uuid, integer, text) to authenticated"
  );
  await db.exec("revoke usage on schema internal from authenticated");
  await assert.rejects(
    asRole("authenticated", claims, rename, [resource, 2, "Missing namespace"]),
    /permission denied/
  );
  await db.exec("grant usage on schema internal to authenticated");
  for (const bad of [
    { ...claims, sub: other },
    { ...claims, session_id: job },
    { ...claims, is_anonymous: true },
    { ...claims, role: "service_role" },
    { ...claims, sub: null, user_metadata: { sub: owner, role: "admin" } },
  ])
    await assert.rejects(
      asRole("authenticated", bad, rename, [resource, 2, "Denied"]),
      /required|unavailable/
    );
  await assert.rejects(asRole("authenticated", claims, rename, [resource, 1, "Stale"]), /changed/);
  await assert.rejects(
    asRole("authenticated", claims, rename, [resource, 2, "x"]),
    /invalid input/
  );
  await assert.rejects(
    asRole("authenticated", claims, "select api.enqueue_transport_reconciliation($1::uuid)", [job]),
    /permission denied/
  );
  await assert.rejects(
    asRole(
      "service_role",
      { role: "authenticated", sub: owner },
      "select api.enqueue_transport_reconciliation($1::uuid)",
      [job]
    ),
    /service required/
  );
  await asRole(
    "service_role",
    { role: "service_role" },
    "select api.enqueue_transport_reconciliation($1::uuid)",
    [job]
  );
  await asRole(
    "service_role",
    { role: "service_role" },
    "select api.enqueue_transport_reconciliation($1::uuid)",
    [job]
  );
  assert.equal(
    (await db.query("select count(*)::int as n from private.transport_jobs")).rows[0].n,
    1
  );
  await db.query("delete from auth.sessions where id = $1", [session]);
  await assert.rejects(
    asRole("authenticated", claims, rename, [resource, 2, "Revoked"]),
    /live session required/
  );
  const grants =
    await db.query(`select has_function_privilege('anon', 'api.rename_transport_resource(uuid,integer,text)', 'execute') as anon,
    has_function_privilege('service_role', 'api.rename_transport_resource(uuid,integer,text)', 'execute') as service,
    has_function_privilege('authenticated', 'internal.rename_transport_resource(uuid,integer,text)', 'execute') as helper`);
  assert.deepEqual(grants.rows[0], { anon: false, service: false, helper: true });
  console.log(
    "BF-04 PGlite supplementary transport checks PASS: wrapper/helper grants, private denial, JWT actor, live session, revision, DTO, machine-only idempotency. Native PostgreSQL/PostgREST/races INCOMPLETE."
  );
} finally {
  await db.close();
}

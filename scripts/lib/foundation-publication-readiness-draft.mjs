import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertFixturePath } from "./foundation-native-paths.mjs";

const catalogue = String.raw`select encode(sha256(convert_to(coalesce(jsonb_agg(
  jsonb_build_object('schema',n.nspname,'name',p.proname,'oid',p.oid,
    'args',oidvectortypes(p.proargtypes),'returns',pg_get_function_result(p.oid),
    'body',p.prosrc,'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,
    'volatile',p.provolatile,'config',p.proconfig) order by n.nspname,p.proname,p.oid),
  '[]'::jsonb)::text,'UTF8')),'hex') from pg_proc p join pg_namespace n
  on n.oid=p.pronamespace where n.nspname in('api','internal');`;

/** Caller must already hold the owned fixture operation mutex. HTTP requires a
 * committed temporary draft; capture exact old definitions before any change
 * and restore with CREATE OR REPLACE (same OIDs/ACLs). No hosted connection. */
export function preparePublicationReadinessDraft(sql) {
  assert.equal(sql("select count(*) from auth.users;"), "0");
  const count = () =>
    sql(
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('api','internal');"
    );
  assert.equal(count(), "240");
  const newSignatures = [
    "api.get_owner_verification_readiness()",
    "internal.get_owner_verification_readiness()",
    "internal.assert_posting_verification_ready(uuid,boolean)",
  ];
  for (const signature of newSignatures)
    assert.equal(
      sql("select to_regprocedure('" + signature + "') is null;"),
      "t",
      "Do not overwrite or drop a pre-existing draft signature"
    );
  const accepted = JSON.parse(
    readFileSync(
      "docs/backend-foundation/evidence/native-2026-10-19T08-48-57.841Z/results.json",
      "utf8"
    )
  );
  const actual = JSON.parse(
    sql(
      "select json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'owner',r.rolname,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in('api','internal');"
    )
  );
  const metadata = actual.map(({ body, ...rest }) => ({
    ...rest,
    bodyHash: createHash("sha256").update(body).digest("base64url"),
  }));
  const sorted = (rows) => rows.sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(
    sorted(metadata),
    sorted(accepted.appliedFunctions),
    "Only the exact accepted24 functions/security metadata may enter this rehearsal"
  );

  const path = "docs/backend-foundation/drafts/publication-verification-readiness.sql";
  assertFixturePath(process.cwd(), path, { type: "file" });
  const bytes = readFileSync(path);
  const before = sql(catalogue);
  const signatures = [
    "internal.submit_post(uuid,integer)",
    "internal.apply_post_edit(uuid,uuid)",
    "internal.moderate_post(uuid,integer,text,text,text,uuid)",
  ];
  const definitions = signatures.map((signature) =>
    JSON.parse(sql("select to_json(pg_get_functiondef('" + signature + "'::regprocedure));"))
  );
  const recoveryPath =
    "docs/backend-foundation/evidence/publication-readiness-draft-recovery-" +
    new Date().toISOString().replaceAll(":", "-") +
    ".json";
  assertFixturePath(process.cwd(), recoveryPath, { allowMissing: true, type: "file" });
  writeFileSync(
    recoveryPath,
    JSON.stringify(
      {
        status: "PREPARED local rehearsal restoration recipe",
        beforeHash: before,
        signatures,
        definitions,
        dropSignatures: [
          "api.get_owner_verification_readiness()",
          "internal.get_owner_verification_readiness()",
          "internal.assert_posting_verification_ready(uuid,boolean)",
        ],
        notice:
          "Exact local fixture only, acquire operation mutex and verify identity/Auth cleanup before recovery. No CASCADE, reset or hosted execution.",
      },
      null,
      2
    ) + "\n",
    { flag: "wx" }
  );
  let attempted = false,
    restored = false;
  const restore = () => {
    if (restored) return;
    if (attempted) {
      sql(
        "begin;\n" +
          definitions.join(";\n") +
          ";\n" +
          String.raw`
drop function if exists api.get_owner_verification_readiness();
drop function if exists internal.get_owner_verification_readiness();
drop function if exists internal.assert_posting_verification_ready(uuid,boolean);
notify pgrst,'reload schema';
commit;`
      );
    }
    assert.equal(sql(catalogue), before, "Exact accepted24 function catalogue restoration");
    assert.equal(count(), "240");
    restored = true;
  };
  return {
    recoveryPath,
    beforeHash: before,
    sourceHash: createHash("sha256").update(bytes).digest("base64url"),
    install() {
      assert.equal(attempted, false);
      attempted = true;
      sql("begin;\n" + bytes.toString("utf8") + "\nnotify pgrst,'reload schema';commit;");
      assert.equal(count(), "243");
    },
    restore,
    afterHash: () => sql(catalogue),
  };
}

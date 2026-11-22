// Shared set-up for the database limit tests (scripts/limits-sql*.test.mjs):
// the replayed production schema (candidate.sql plus every update) in the
// embedded Postgres of the replay gate, synthetic members and staff, and
// helpers that call the production API as a member, staff member, the service
// role or a visitor. No Docker, no hosted database.
import assert from "node:assert/strict";
import { replayFoundation } from "./foundation-replay.mjs";

const FIXTURES = `create schema vmtest;
  create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
  declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
    insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
      values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
    insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
    return jsonb_build_object('id',uid,'session',sid);
  end$$;
  -- Staff: an AAL2 session, a verified authenticator app, a role and a
  -- current accepted ID review of their own (internal.current_verified_identity:
  -- a decided case with its reviewed submission, a synthetic identity
  -- fingerprint, a verified phone and an area), since staff review posts only
  -- with one (20261121143000_one_person_admin_mode.sql).
  create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
  declare m jsonb:=vmtest.member(p_label); uid uuid:=(m->>'id')::uuid; c uuid:=gen_random_uuid();
    ida uuid:=gen_random_uuid(); sea uuid:=gen_random_uuid(); sub uuid:=gen_random_uuid();
    fp text:=left(translate(encode(sha256(convert_to(uid::text,'UTF8')),'base64'),'+/=','-_'),42)||'A'; begin
    update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
    insert into auth.mfa_factors(user_id,factor_type,status) values(uid,'totp','verified');
    insert into private.staff_roles(user_id,role) values(uid,p_role);
    perform set_config('session_replication_role','replica',true);
    insert into private.evidence_cases(id,subject_id,kind,status,version) values(c,uid,'kyc','decided',2);
    insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,deleted_at)
      values(ida,c,uid,'id_front','evidence/'||c||'/'||ida,'deleted',now()),(sea,c,uid,'selfie','evidence/'||c||'/'||sea,'deleted',now());
    insert into private.verification_identity_submissions(id,case_id,owner_id,case_version,id_artifact_id,
        selfie_artifact_id,identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,
        receipt_id,recipe,risk_score)
      values(sub,c,uid,1,ida,sea,fp,'identity-match-v1',repeat('a1',13),repeat('b2',12),repeat('c3',16),
        'identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',10);
    insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by)
      values(uid,sub,fp,gen_random_uuid());
    insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
      values(uid,gen_random_uuid(),'+2783'||lpad((abs(hashtext(uid::text))%10000000)::text,7,'0'));
    insert into private.verification_localities(owner_id,province_id,city_id) values(uid,'gp','gp_johannesburg');
    perform set_config('session_replication_role','origin',true);
    return m || jsonb_build_object('staff',true);
  end$$;`;

export const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

/**
 * An address of exactly `n` characters (n >= 7): a short local part and a long
 * domain of labels of at most 50 characters, so only a length rule can refuse it.
 */
export function emailOfLength(n) {
  const room = n - 2 - ".com".length;
  let domain = "";
  while (domain.length < room)
    domain += `${domain ? "." : ""}${"d".repeat(Math.min(50, room - domain.length - (domain ? 1 : 0)))}`;
  const value = `a@${domain}.com`;
  assert.equal(value.length, n);
  return value;
}

/** Opens the replayed schema with the fixtures; the caller closes `db`. */
export async function openLimitsDb() {
  const { db } = await replayFoundation();
  await db.exec(FIXTURES);

  const one = async (sql, params) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
  const member = (label) => one(`select vmtest.member($1)`, [label]);
  const staff = (label, role = "admin") => one(`select vmtest.staff($1,$2)`, [label, role]);

  /**
   * Runs `sql` as `role` (null: the database owner, for internal helpers that
   * no API role may call); with `user`, under that user's JWT claims (staff
   * users carry AAL2 and a fresh authenticator-app proof; `user.amr` sets the
   * sign-in methods).
   */
  async function as(role, sql, user) {
    const claims = user
      ? {
          sub: user.id,
          role: "authenticated",
          session_id: user.session,
          aal: user.staff ? "aal2" : "aal1",
          is_anonymous: false,
          ...(user.staff
            ? { amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] }
            : {}),
          ...(user.amr ? { amr: user.amr } : {}),
        }
      : { role: role ?? "postgres" };
    await db.exec(`select set_config('request.jwt.claim.sub',${lit(user?.id ?? "")},false),
        set_config('request.jwt.claims',${lit(JSON.stringify(claims))},false);
      ${role ? `set role ${role};` : ""}`);
    try {
      return (await db.query(sql)).rows;
    } finally {
      await db.exec(
        `reset role; select set_config('request.jwt.claims','',false), set_config('request.jwt.claim.sub','',false);`
      );
    }
  }

  /** The owner writes `sql` with triggers and foreign-key checks off (fixtures). */
  const seed = (sql) =>
    db.exec(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);

  return {
    db,
    one,
    member,
    staff,
    as,
    seed,
    asMember: (user, sql) => as("authenticated", sql, user),
    asStaff: (user, sql) => as("authenticated", sql, user),
    asService: (sql) => as("service_role", sql),
    asVisitor: (sql) => as("anon", sql),
    asOwner: (sql, user) => as(null, sql, user),
  };
}

/** Asserts that `promise` is refused with `code` and, when given, `message`. */
export async function refused(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

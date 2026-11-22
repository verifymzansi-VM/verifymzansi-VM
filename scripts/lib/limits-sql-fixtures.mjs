// Shared fixtures for the database limit tests that need a larger world than
// scripts/lib/limits-sql-harness.mjs gives: a member whose ID review is
// accepted, the Multi-listing package world, business (CIPC and seen) cases
// held by a staff member, Ozow refund sends and bulk rows.
//
// Every fixture writes rows directly as the database owner with triggers and
// foreign-key checks off (h.seed); the limit itself is then proved by calling
// the real function. Nothing here reaches a hosted database.
import { randomUUID } from "node:crypto";
import { lit } from "./limits-sql-harness.mjs";

export const json = (value) => `${lit(JSON.stringify(value))}::jsonb`;
/** A 64-character lower-case hex digest derived from `label`. */
export const digest = (label) =>
  [...String(label)]
    .map((c) => c.charCodeAt(0).toString(16))
    .join("")
    .padEnd(64, "0")
    .slice(0, 64);
const sha = (id) => `encode(sha256(convert_to(${lit(id)},'UTF8')),'hex')`;

/** A fingerprint in the identity format, unique to `id`. */
export const fingerprintSql = (id) =>
  `left(translate(encode(sha256(convert_to(${lit(id)}||':fp','UTF8')),'base64'),'+/=','-_'),42)||'A'`;

/**
 * Accepts `user`'s ID review the way the real flow leaves it: a decided ID case
 * (version 2) with its clean ID photo and selfie, the submission and the
 * accepted fact; plus a confirmed phone and locality, so
 * internal.current_verified_identity(user) is set. Returns the case,
 * submission and fact ids.
 */
export async function acceptIdentity(h, user) {
  const ids = {
    case: randomUUID(),
    idPhoto: randomUUID(),
    selfie: randomUUID(),
    submission: randomUUID(),
    fact: randomUUID(),
  };
  await h.seed(`
    insert into private.evidence_cases(id,subject_id,kind,status,version) values(${lit(ids.case)},${lit(user.id)},'kyc','decided',2);
    insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,content_sha256) values
      (${lit(ids.idPhoto)},${lit(ids.case)},${lit(user.id)},'id_front',${lit(`evidence/${ids.idPhoto}`)},'clean',${sha(ids.idPhoto)},${sha(ids.idPhoto)}),
      (${lit(ids.selfie)},${lit(ids.case)},${lit(user.id)},'selfie',${lit(`evidence/${ids.selfie}`)},'clean',${sha(ids.selfie)},${sha(ids.selfie)});
    insert into private.verification_identity_submissions(id,case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,identity_hmac,
        identity_key_id,encryption_key_id,receipt_id,recipe,risk_score,number_ciphertext,number_iv,number_tag)
      values(${lit(ids.submission)},${lit(ids.case)},${lit(user.id)},1,${lit(ids.idPhoto)},${lit(ids.selfie)},${fingerprintSql(user.id)},
        'identity-match-v1','identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',0,
        ${lit("a".repeat(26))},${lit("b".repeat(24))},${lit("c".repeat(32))});
    insert into private.accepted_identity_facts(id,owner_id,submission_id,identity_hmac,reviewed_by)
      values(${lit(ids.fact)},${lit(user.id)},${lit(ids.submission)},${fingerprintSql(user.id)},gen_random_uuid());
    insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
      values(${lit(user.id)},gen_random_uuid(),'+2783'||lpad((abs(hashtext(${lit(user.id)}))%10000000)::text,7,'0'));
    insert into private.verification_localities(owner_id,province_id,city_id) values(${lit(user.id)},'gp','gp_johannesburg');`);
  return ids;
}

/** A staff member (h.staff) whose own ID review is accepted in full. */
export async function verifiedStaff(h, label, role = "admin") {
  const user = await h.staff(label, role);
  await h.seed(
    `update private.accepted_identity_facts set revoked_at=now() where owner_id=${lit(user.id)};`
  );
  await acceptIdentity(h, user);
  return user;
}

/**
 * An open ID case of a new member, held by `reviewer`, with its current
 * submission (risk `risk`) and clean ID photo and selfie.
 */
export async function heldIdentityCase(h, reviewer, risk) {
  const owner = await h.member(`id-case-${risk}`);
  const ids = {
    owner,
    case: randomUUID(),
    nonce: randomUUID(),
    idPhoto: randomUUID(),
    selfie: randomUUID(),
    submission: randomUUID(),
  };
  await h.seed(`
    insert into private.evidence_cases(id,subject_id,kind,claimed_by,claim_expires_at,claim_generation,claim_nonce)
      values(${lit(ids.case)},${lit(owner.id)},'kyc',${lit(reviewer.id)},now()+interval '30 minutes',1,${lit(ids.nonce)});
    insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,content_sha256) values
      (${lit(ids.idPhoto)},${lit(ids.case)},${lit(owner.id)},'id_front',${lit(`evidence/${ids.idPhoto}`)},'clean',${sha(ids.idPhoto)},${sha(ids.idPhoto)}),
      (${lit(ids.selfie)},${lit(ids.case)},${lit(owner.id)},'selfie',${lit(`evidence/${ids.selfie}`)},'clean',${sha(ids.selfie)},${sha(ids.selfie)});
    insert into private.verification_identity_submissions(id,case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,identity_hmac,
        identity_key_id,encryption_key_id,receipt_id,recipe,risk_score,number_ciphertext,number_iv,number_tag)
      values(${lit(ids.submission)},${lit(ids.case)},${lit(owner.id)},1,${lit(ids.idPhoto)},${lit(ids.selfie)},${fingerprintSql(owner.id)},
        'identity-match-v1','identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',${risk},
        ${lit("a".repeat(26))},${lit("b".repeat(24))},${lit("c".repeat(32))});
    insert into private.identity_submission_names(submission_id,owner_id,legal_first_name,legal_last_name)
      values(${lit(ids.submission)},${lit(owner.id)},'Thando','Dlamini');
    insert into private.verification_current_submissions(case_id,submission_id) values(${lit(ids.case)},${lit(ids.submission)});`);
  return ids;
}

/** A member whose ID review is accepted. */
export async function verifiedMember(h, label) {
  const user = await h.member(label);
  await acceptIdentity(h, user);
  return user;
}

// ---------------------------------------------------------------- packages

/** Switches Multi-listing package sales on or off. */
export const packagesOnSale = (h, value = true) =>
  h.seed(
    `update private.slot_package_sales set on_sale=${value},changed_at=now(),reason='Fixture: switched for the limit checks';`
  );

/** The live plan version of a package term (30, 90 or 180 days). */
export const packagePlan = (h, term) =>
  h.one(`select id from internal.slot_package_term_plan($1)`, [term]);

/**
 * A running package of `owner`: a complete package payment and one active
 * grant of `places` slots that ends `days` whole days (and 12 hours) from now.
 * Returns { id, entitlement, payment }.
 */
export async function runningPackage(h, owner, { places, days, term = 30 }) {
  const ids = {
    id: randomUUID(),
    entitlement: randomUUID(),
    payment: randomUUID(),
    line: randomUUID(),
  };
  const plan = await packagePlan(h, term);
  await h.seed(`
    insert into private.slot_packages(id,owner_id,term_days,slot_count) values(${lit(ids.id)},${lit(owner.id)},${term},${Math.max(5, Math.min(places, 250))});
    insert into private.payments(id,owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,fulfillment_status,completed_at,provider)
      values(${lit(ids.payment)},${lit(owner.id)},'plan',${lit(plan)},100,'ZAR','{"category":"slot_package"}'::jsonb,'complete','fulfilled',now()-interval '1 day','invoice');
    insert into private.payment_lines(id,payment_id,line_number,plan_version_id,amount_cents,slot_count)
      values(${lit(ids.line)},${lit(ids.payment)},1,${lit(plan)},100,${places});
    insert into private.entitlements(id,owner_id,source,payment_id,payment_line_id,package_id,slot_capacity,activations_per_period,
        max_photos,max_videos,starts_at,ends_at,status)
      values(${lit(ids.entitlement)},${lit(owner.id)},'retail_paid',${lit(ids.payment)},${lit(ids.line)},${lit(ids.id)},${places},${places * 4},
        10,1,now()-interval '1 day',now()+make_interval(days=>${days},hours=>12),'active');`);
  return ids;
}

/** Moves a package's end to `days` whole days (and 12 hours) from now. */
export const setPackageDaysLeft = (h, pkg, days) =>
  h.seed(
    `update private.entitlements set ends_at=now()+make_interval(days=>${days},hours=>12) where package_id=${lit(pkg.id)};`
  );

/**
 * A cheap package term for limits that a real price would hide behind the
 * online payment maximum: a newer 180-day package plan version at 180 cents
 * (1 cent a slot per day). It becomes the 180-day term's plan in this database.
 */
export async function cheapPackagePlan(h) {
  const id = randomUUID();
  await h.seed(`insert into private.plan_versions
      select (jsonb_populate_record(v, jsonb_build_object('id',${lit(id)},'version',v.version+90,'price_cents',180))).*
      from private.plan_versions v where v.plan_code='slot_package_180d' and v.retired_at is null order by v.version desc limit 1;`);
  return id;
}

// ---------------------------------------------------------------- business cases

/** A business post of `owner` (fixture), live by default. */
export async function businessPost(h, owner, { status = "live" } = {}) {
  const id = randomUUID();
  const c = (
    await h.db.query(
      `select category_key from private.post_category_contracts where kind='business' order by category_key limit 1`
    )
  ).rows[0];
  await h.seed(`insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id,status,published_at,visible_until)
      values(${lit(id)},${lit(owner.id)},'business','business',${lit(c.category_key)},'Fixture business',
        'A synthetic description long enough for every rule.','gp','gp_johannesburg',${lit(status)},now()-interval '1 hour',
        ${status === "live" ? "now()+interval '30 days'" : "null"});
    insert into private.business_details(post_id) values(${lit(id)});`);
  return id;
}

/**
 * An open business check of `owner` on `business`: the evidence case, the
 * check row and, for CIPC, its review. With `claimedBy`, a live claim of that
 * staff member (generation 1). Returns { id, nonce, updatedAt }.
 */
export async function businessCase(
  h,
  owner,
  business,
  {
    kind = "seen",
    claimedBy,
    assignedTo,
    route = "director",
    submitted = true,
    method = "video",
    extra = "",
  } = {}
) {
  const id = randomUUID();
  const nonce = randomUUID();
  await h.seed(`
    insert into private.evidence_cases(id,subject_id,kind,claimed_by,claim_expires_at,claim_generation,claim_nonce)
      values(${lit(id)},${lit(owner.id)},'business',${claimedBy ? `${lit(claimedBy.id)},now()+interval '30 minutes',1,${lit(nonce)}` : "null,null,0,null"});
    insert into private.frontend_business_checks(id,business_id,owner_id,kind,seen_method,visit_address,available_slots,screenshots_consent_at,assigned_to)
      values(${lit(id)},${lit(business)},${lit(owner.id)},${lit(kind)},
        ${kind === "seen" ? `${lit(method)},${method === "visit" ? "'1 Fixture Street'" : "null"},array['Monday morning'],now()` : "null,null,null,null"},
        ${assignedTo ? lit(assignedTo.id) : "null"});
    ${
      kind === "seen"
        ? ""
        : `insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at)
             values(${lit(id)},'2020/123456/07',${lit(route)},${submitted ? "now()" : "null"});`
    }
    ${extra.replaceAll("$CASE", lit(id))}`);
  const updatedAt = await h.one(
    `select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from private.frontend_business_checks where id=$1`,
    [id]
  );
  return { id, nonce, updatedAt };
}

/** `count` clean evidence files of a case (fixture), one SQL statement each kind. */
export const caseArtifacts = (caseId, owner, count, purpose, then) =>
  count
    ? `with a as (insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,content_sha256)
         select gen_random_uuid(),${lit(caseId)},${lit(owner.id)},${lit(purpose)},'evidence/'||gen_random_uuid(),'clean',
           ${sha("x")},encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex')
         from generate_series(1,${count}) returning id,content_sha256) ${then}`
    : "";

// ---------------------------------------------------------------- refunds

/**
 * An Ozow refund (fixture) sent `attempts` times: sent 1 hour ago, last tried
 * 31 minutes ago, outcome unknown and no Ozow refund id yet.
 */
export async function sentRefund(h, owner, attempts, { sentAgo = "1 hour" } = {}) {
  const id = randomUUID();
  const payment = randomUUID();
  await h.seed(`
    insert into private.payments(id,owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,fulfillment_status,completed_at,provider,provider_transaction_id)
      values(${lit(payment)},${lit(owner.id)},'plan',gen_random_uuid(),10000,'ZAR','{}'::jsonb,'complete','fulfilled',now()-interval '2 days','ozow',gen_random_uuid()::text);
    insert into private.payment_refund_requests(id,payment_id,account_id,kind,reason_code,reason,ozow_reference,amount_cents,
        recorded_before_cents,needs_approval,status,requested_by,requested_at,channel,approved_at,ozow_transaction_id,sent_at,
        send_attempts,last_send_at,send_outcome)
      values(${lit(id)},${lit(payment)},${lit(owner.id)},'refunded','billing_error','Synthetic refund reason',${lit(`vm-refund-${id}`)},
        10000,0,false,'sent',gen_random_uuid(),now()-interval '2 hours','api',now()-interval '2 hours',gen_random_uuid(),
        now()-interval ${lit(sentAgo)},${attempts},now()-interval '31 minutes','unknown');`);
  return id;
}

/**
 * `count` live business posts of `owner` that the public may see (fixture):
 * each published, funded by an active staff-granted slot and activated.
 * Returns their ids.
 */
export async function livePosts(h, owner, count = 1) {
  const rows = await h.db.query(
    `select gen_random_uuid()::text as id from generate_series(1,${count})`
  );
  const ids = rows.rows.map((row) => row.id);
  const list = `array[${ids.map(lit).join(",")}]::uuid[]`;
  await h.seed(`
    insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id,status,published_at,visible_until)
      select id,${lit(owner.id)},'business','business',(select category_key from private.post_category_contracts where kind='business' order by 1 limit 1),
        'Fixture business '||left(id::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg','live',
        now()-interval '1 hour',now()+interval '30 days'
      from unnest(${list}) id;
    insert into private.business_details(post_id) select id from unnest(${list}) id;
    with e as (insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at,status)
        select ${lit(owner.id)},'staff_grant',gen_random_uuid(),1,10,1,now()-interval '1 day',now()+interval '30 days','active'
        from unnest(${list}) id returning id),
      n as (select id, row_number() over () r from e), p as (select id, row_number() over () r from unnest(${list}) id)
    insert into private.post_activations(post_id,entitlement_id,owner_id,activated_at)
      select p.id,n.id,${lit(owner.id)},now()-interval '1 hour' from p join n using (r);`);
  return ids;
}

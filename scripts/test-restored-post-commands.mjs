import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { nativeTotp } from "./lib/foundation-native-totp.mjs";
import { buildRestoredPostInput } from "../src/lib/foundation/restored-post-input.ts";
import { processIdentityNumber } from "../src/lib/domains/verification/identity-processing.ts";
import {
  parseRestoredOwnerPost,
  restoredOwnerPostRow,
} from "../src/lib/foundation/restored-owner-posts.ts";
assert.equal(process.argv.length, 2);
const isolation = nativeIsolation(),
  release = acquireFixtureOperation(isolation.workdir, "test");
const tracked = [];
const report = {
  at: new Date().toISOString(),
  status: "INCOMPLETE",
  scope:
    "Native PostgreSQL form-command transaction with real local GoTrue owner/reviewer sessions and TOTP; synthetic scanner/provider receipts, no real documents or R2 writes",
  productionMutations: [],
  checks: [],
};
const sql = (query) =>
  execFileSync(
    "docker",
    [
      ...isolation.dockerArgs,
      "exec",
      "-i",
      "supabase_db_backend-foundation-impl",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
    ],
    {
      input: query,
      encoding: "utf8",
      env: isolation.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: 30000,
    }
  ).trim();
let admin,
  stage = "fixture preflight";
try {
  assert.equal(
    sql("select count(*) from auth.users;"),
    "0",
    "Existing fixture users must not be modified"
  );
  const status = JSON.parse(
    execFileSync(
      process.execPath,
      [isolation.cliPath, "status", "-o", "json", "--workdir", isolation.workdir],
      { encoding: "utf8", env: isolation.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    )
  );
  const endpoint = new URL(status.API_URL);
  assert.equal(endpoint.origin, "http://127.0.0.1:55441");
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  admin = createClient(endpoint.origin, status.SECRET_KEY, options);
  async function user(label) {
    stage = `local Auth ${label}`;
    const email = `restored-${label}-${randomUUID()}@example.invalid`,
      password = randomBytes(24).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    const account = {
      id: created.data.user.id,
      client: createClient(endpoint.origin, status.PUBLISHABLE_KEY, options),
    };
    tracked.push(account);
    const logged = await account.client.auth.signInWithPassword({ email, password });
    assert.equal(logged.error, null);
    account.claims = JSON.parse(
      Buffer.from(logged.data.session.access_token.split(".")[1], "base64url")
    );
    return account;
  }
  stage = "real local Auth sessions";
  const owner = await user("owner"),
    reviewer = await user("reviewer"),
    unverified = await user("unverified");
  stage = "real local reviewer TOTP";
  const enrolled = await reviewer.client.auth.mfa.enroll({ factorType: "totp" });
  assert.equal(enrolled.error, null);
  const challenge = await reviewer.client.auth.mfa.challenge({ factorId: enrolled.data.id });
  assert.equal(challenge.error, null);
  const verified = await reviewer.client.auth.mfa.verify({
    factorId: enrolled.data.id,
    challengeId: challenge.data.id,
    code: nativeTotp(enrolled.data.totp.secret),
  });
  assert.equal(verified.error, null);
  reviewer.claims = JSON.parse(
    Buffer.from(
      (await reviewer.client.auth.getSession()).data.session.access_token.split(".")[1],
      "base64url"
    )
  );
  assert.equal(reviewer.claims.aal, "aal2");
  const claims = (account) =>
    `perform set_config('request.jwt.claims','${JSON.stringify(account.claims)}',true);`;
  const request = randomUUID(),
    editRequest = randomUUID(),
    otherRequest = randomUUID(),
    businessRequest = randomUUID(),
    eventRequest = randomUUID(),
    placeholder = randomUUID();
  const policy = {
    version: "fixture-posting-v1",
    document_hash: createHash("sha256")
      .update("Synthetic fixture posting terms v1")
      .digest("base64url"),
  };
  const payload = buildRestoredPostInput("listings", {
    postRequestId: request,
    postingTerms: policy,
    termsAccepted: true,
    title: "Example native form listing",
    description: "A sufficiently detailed synthetic listing for native command checks.",
    price_zar: 120,
    category: "other_items",
    attributes: { brand: "Example" },
    condition: "good",
    province: "Gauteng",
    city: "Johannesburg",
    images: [`https://media.verifymzansi.com/media/${placeholder}`],
    logo_url: `https://media.verifymzansi.com/media/${placeholder}`,
    videoThumbnail: `https://media.verifymzansi.com/media/${placeholder}`,
    town: "Fixture suburb",
    address: "Fixture address",
    contactMethods: ["form"],
    trialDays: 7,
  });
  const businessPayload = buildRestoredPostInput("businesses", {
    postRequestId: businessRequest,
    postingTerms: policy,
    termsAccepted: true,
    business_name: "Example native shop",
    slug: "example-native-shop",
    category: "general_other",
    description: "A synthetic native business description.",
    business_type: "standalone_shop",
    business_details: {
      type: "standalone_shop",
      street_address: "Fixture street",
      suburb: "Fixture suburb",
    },
    location_province: "Gauteng",
    location_city: "Johannesburg",
    location_address: "Fixture street",
    contact_methods: ["form"],
    gallery_photos: [`https://media.verifymzansi.com/media/${placeholder}`],
    logo_url: `https://media.verifymzansi.com/media/${placeholder}`,
    website: "https://example.com",
    services_offered: ["Example service"],
    operating_hours: { Mon_Fri: "09:00-17:00" },
  });
  const eventPayload = buildRestoredPostInput("promotions", {
    postRequestId: eventRequest,
    postingTerms: policy,
    termsAccepted: true,
    title: "Example native festival",
    description: "A sufficiently detailed synthetic festival description.",
    promotion_type: "event",
    province: "Gauteng",
    city: "Johannesburg",
    images: [`https://media.verifymzansi.com/media/${placeholder}`],
    contact_methods: ["form"],
    start_date: new Date(Date.now() + 86400000).toISOString(),
    end_date: new Date(Date.now() + 90000000).toISOString(),
    event_details: {
      event_type: "festival_concert",
      venue_name: "Fixture venue",
      tickets_url: "https://example.com/tickets",
    },
  });
  const identity = processIdentityNumber(owner.id, "8001015009087", {
    identityMatchKey: randomBytes(32).toString("hex"),
    numberEncryptionKey: randomBytes(32).toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  });
  const overlay = (file) =>
    readFileSync(file, "utf8")
      .replace(/^begin;\s*$/gm, "")
      .replace(/^commit;\s*$/gm, "");
  const files = [
    "database/foundation/updates/20261029191349_restore_public_browse_contract.sql",
    "database/foundation/updates/20261104000046_restored_verification_transport.sql",
    "database/foundation/updates/20261104002445_restored_post_commands.sql",
    "database/foundation/updates/20261104042501_preserve_existing_edit_consent.sql",
    "database/foundation/updates/20261104043441_restored_post_manager.sql",
    "database/foundation/updates/20261104044439_preserve_post_contact_privacy.sql",
    "database/foundation/updates/20261104045254_align_frontend_receipt_retention.sql",
    "database/foundation/updates/20261104052154_repeatable_frontend_media_uploads.sql",
  ];
  report.provenance = Object.fromEntries(
    files.map((f) => [f, createHash("sha256").update(readFileSync(f)).digest("hex")])
  );
  stage = "native overlay and full posting transaction";
  const outcome = sql(`begin;
    ${files.map(overlay).join("\n")}
    insert into private.posting_terms_versions(version,document_hash) values('${policy.version}','${policy.document_hash}');
    insert into private.posting_terms_current(version) values('${policy.version}');
    insert into private.staff_roles(user_id,role,granted_by) values('${reviewer.id}','moderator','${owner.id}');
    create temporary table restored_owner_form_probe(value jsonb);
    create function pg_temp.bind_frontend_media(p_input jsonb) returns jsonb language plpgsql as $$
    declare keys text[]; resolved jsonb; images jsonb; extras jsonb;begin
      select coalesce(array_agg(distinct i.value->>'object_key'),'{}'::text[]) into keys
        from jsonb_array_elements((p_input->'media')||(p_input->'presentation_media')) i(value);
      resolved:=api.resolve_my_frontend_media(keys,null);
      select coalesce(jsonb_agg((i.value-'object_key')||jsonb_build_object('object_id',
        (select m.value->'object_id' from jsonb_array_elements(resolved)m(value) where m.value->>'object_key'=i.value->>'object_key'))),'[]'::jsonb)
        into images from jsonb_array_elements(p_input->'media')i(value);
      select coalesce(jsonb_agg((i.value-'object_key')||jsonb_build_object('object_id',
        (select m.value->'object_id' from jsonb_array_elements(resolved)m(value) where m.value->>'object_key'=i.value->>'object_key'))),'[]'::jsonb)
        into extras from jsonb_array_elements(p_input->'presentation_media')i(value);
      return p_input||jsonb_build_object('media',images,'presentation_media',extras);
    end$$;
    do $fixture$ declare c jsonb; i jsonb; face jsonb; lease jsonb; submission jsonb; proof jsonb; picture jsonb; logo jsonb; poster jsonb;
      input jsonb:=$payload$${JSON.stringify(payload)}$payload$::jsonb;
      business_input jsonb:=$business$${JSON.stringify(businessPayload)}$business$::jsonb;
      event_input jsonb:=$event$${JSON.stringify(eventPayload)}$event$::jsonb;
      answer jsonb; again jsonb; edited jsonb; rev integer; total integer;
    begin
      ${claims(owner)}
      perform api.save_my_legal_name((api.get_my_profile()->>'revision')::integer,'Fixture','Owner');
      c:=api.open_verification_case();
      i:=api.begin_evidence_upload((c->>'case_id')::uuid,'id_front');
      face:=api.begin_evidence_upload((c->>'case_id')::uuid,'selfie');
      perform api.advance_evidence_artifact((i->>'artifact_id')::uuid,'uploaded',repeat('a',64),128);
      perform api.advance_evidence_artifact((i->>'artifact_id')::uuid,'clean',repeat('a',64),128);
      perform api.advance_evidence_artifact((face->>'artifact_id')::uuid,'uploaded',repeat('b',64),128);
      perform api.advance_evidence_artifact((face->>'artifact_id')::uuid,'clean',repeat('b',64),128);
      select version into rev from private.evidence_cases where id=(c->>'case_id')::uuid;
      submission:=api.register_identity_submission((c->>'case_id')::uuid,rev,(i->>'artifact_id')::uuid,(face->>'artifact_id')::uuid,
        '${identity.fingerprint}','identity-match-v1','${JSON.stringify(identity.encryptedNumber)}',gen_random_uuid(),10);
      ${claims(reviewer)}
      lease:=api.claim_evidence_case((c->>'case_id')::uuid);
      proof:=api.review_identity_submission((submission->>'submission_id')::uuid,(submission->>'case_version')::integer,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true,true);
      if proof->>'status'<>'accepted' then raise exception 'native review did not accept synthetic evidence'; end if;
      ${claims(owner)}
      proof:=api.create_verification_phone_challenge('${owner.id}','+27700000123',repeat('e',64));
      perform api.claim_verification_phone_attempt('${owner.id}',(proof->>'challenge_id')::uuid);
      perform api.finalize_verification_phone('${owner.id}',(proof->>'challenge_id')::uuid,repeat('e',64));
      perform api.confirm_verification_locality('gp','gp_johannesburg');
      if internal.current_verified_identity('${owner.id}') is null then raise exception 'native publication facts missing'; end if;
      picture:=api.reserve_frontend_media_upload('image',128,repeat('a',64));logo:=api.reserve_frontend_media_upload('image',128,repeat('b',64));poster:=api.reserve_frontend_media_upload('image',128,repeat('c',64));
      if api.reserve_frontend_media_upload('image',128,repeat('a',64))->>'object_id'<>picture->>'object_id' then raise exception 'media retry reserved storage twice';end if;
      perform api.complete_frontend_media_upload((picture->>'object_id')::uuid,128,repeat('a',64),'image/jpeg',800,600);
      perform api.complete_frontend_media_upload((picture->>'object_id')::uuid,128,repeat('a',64),'image/jpeg',800,600);
      perform api.complete_frontend_media_upload((logo->>'object_id')::uuid,128,repeat('b',64),'image/jpeg',800,600);
      perform api.complete_frontend_media_upload((poster->>'object_id')::uuid,128,repeat('c',64),'image/jpeg',800,600);
      if api.reserve_frontend_media_upload('image',128,repeat('a',64))->>'state'<>'ready' then raise exception 'completed upload retry lost receipt';end if;
      perform api.set_my_avatar((api.get_my_profile()->>'revision')::integer,(picture->>'object_id')::uuid);
      c:=api.resolve_my_frontend_media(null,array[(picture->>'object_id')::uuid]);
      if c->0->>'object_key'<>picture->>'object_key' then raise exception 'avatar ID/key binding failed';end if;
      input:=jsonb_set(input,'{media,0,object_key}',picture->'object_key');
      input:=jsonb_set(input,'{presentation_media,0,object_key}',logo->'object_key');
      input:=jsonb_set(input,'{presentation_media,1,object_key}',poster->'object_key');
      input:=pg_temp.bind_frontend_media(input);
      perform api.stage_frontend_post_command('${owner.id}','${request}',repeat('d',64),input);
      begin perform api.stage_frontend_post_command('${owner.id}','${request}',repeat('e',64),input);raise exception 'changed request accepted';exception when sqlstate 'PT409' then null;end;
      answer:=api.consume_frontend_post_command('${request}');again:=api.consume_frontend_post_command('${request}');
      if answer<>again or answer->>'status'<>'pending_moderation' then raise exception 'owner command idempotence failed'; end if;
      if not internal.media_object_in_use((logo->>'object_id')::uuid) or not internal.media_object_in_use((poster->>'object_id')::uuid) then raise exception 'supplemental media omitted from retention'; end if;
      if (select payload from private.frontend_post_commands where request_id='${request}') is not null then raise exception 'redundant command payload retained'; end if;
      ${claims(reviewer)}
      lease:=api.claim_queue_item('post',(answer->>'id')::uuid);
      perform api.moderate_post((answer->>'id')::uuid,(answer->>'revision')::integer,'approve',lease->>'claim_generation',(lease->>'claim_nonce')::uuid,null);
      select revision into rev from private.posts where id=(answer->>'id')::uuid;
      ${claims(owner)}
      input:=jsonb_set(input,'{request_id}',to_jsonb('${editRequest}'::text))||jsonb_build_object('target_id',answer->>'id','expected_revision',rev);
      input:=jsonb_set(input,'{presentation,location_address}','"Updated fixture address"');
      perform api.stage_frontend_post_command('${owner.id}','${editRequest}',repeat('f',64),input);
      edited:=api.consume_frontend_post_command('${editRequest}');
      if (select status from private.posts where id=(answer->>'id')::uuid)<>'live' then raise exception 'public original changed before moderation'; end if;
      if internal.edit_is_price_only((answer->>'id')::uuid,(edited->>'id')::uuid) then raise exception 'presentation edit escaped edit budget'; end if;
      ${claims(reviewer)}
      lease:=api.claim_queue_item('post',(edited->>'id')::uuid);
      perform api.moderate_post((edited->>'id')::uuid,(edited->>'revision')::integer,'approve',lease->>'claim_generation',(lease->>'claim_nonce')::uuid,null);
      if (select data->>'location_address' from private.post_presentations where post_id=(answer->>'id')::uuid)<>'Updated fixture address' then raise exception 'approved presentation not merged'; end if;
      ${claims(owner)}
      if api.get_my_frontend_post((answer->>'id')::uuid)->'frontend'->'data'->>'location_address'<>'Updated fixture address' then raise exception 'owner form did not restore actual fields'; end if;
      insert into restored_owner_form_probe values(api.get_my_frontend_post((answer->>'id')::uuid));
      if api.list_my_frontend_posts('listing')->>'total'<>'1' then raise exception 'owner list count changed'; end if;
      again:=api.search_post_cards(jsonb_build_object('post_id',answer->>'id','offset',0,'limit',1,'presentation',true));
      if again->'items'->0->'presentation' ? 'frontend' then raise exception 'existing presentation contract changed'; end if;
      again:=api.search_post_cards(jsonb_build_object('post_id',answer->>'id','offset',0,'limit',1,'presentation',true,'frontend_presentation',true));
      if again->'items'->0->'presentation'->'frontend'->'data' ? 'location_address' then raise exception 'private seller street address leaked'; end if;
      select revision into rev from private.posts where id=(answer->>'id')::uuid;
      perform api.set_post_state((answer->>'id')::uuid,rev,'pause');
      again:=api.search_post_cards(jsonb_build_object('post_id',answer->>'id','offset',0,'limit',1,'presentation',true,'frontend_presentation',true));
      if jsonb_array_length(again->'items')<>0 then raise exception 'paused post leaked public presentation'; end if;
      business_input:=jsonb_set(business_input,'{media,0,object_key}',picture->'object_key');
      business_input:=jsonb_set(business_input,'{presentation_media,0,object_key}',logo->'object_key');
      business_input:=pg_temp.bind_frontend_media(business_input);
      perform api.stage_frontend_post_command('${owner.id}','${businessRequest}',repeat('b',64),business_input);
      again:=api.consume_frontend_post_command('${businessRequest}');
      if again->>'status'<>'pending_moderation' or api.get_my_frontend_post((again->>'id')::uuid)->'frontend'->'data'->'services_offered'->>0<>'Example service' then raise exception 'business form data lost'; end if;
      event_input:=jsonb_set(event_input,'{media,0,object_key}',picture->'object_key');
      event_input:=pg_temp.bind_frontend_media(event_input);
      event_input:=jsonb_set(event_input,'{presentation,business_id}',again->'id');
      perform api.stage_frontend_post_command('${owner.id}','${eventRequest}',repeat('c',64),event_input);
      again:=api.consume_frontend_post_command('${eventRequest}');
      if again->>'status'<>'pending_moderation' or api.get_my_frontend_post((again->>'id')::uuid)->'frontend'->'data'->'event_details'->>'venue_name'<>'Fixture venue' then raise exception 'event form data lost'; end if;
      c:=api.get_my_frontend_post_manager();
      if c->>'account_id'<>'${owner.id}' or c->'slot_usage'->0->>'activeUsage'<>'1' or c->'slot_usage'->0->>'activationCount'<>'2' then raise exception 'native manager allowance facts changed'; end if;
      if api.get_my_frontend_post((again->>'id')::uuid)->>'expires_at' is null then raise exception 'pending event lost actual end time'; end if;
      ${claims(unverified)}
      begin perform api.resolve_my_frontend_media(array[picture->>'object_key'],null);raise exception 'foreign upload key resolved';exception when invalid_parameter_value then null;end;
      if api.get_my_frontend_post((answer->>'id')::uuid) is not null or api.list_my_frontend_posts('listing')->>'total'<>'0' then raise exception 'foreign owner posts leaked'; end if;
      begin perform api.consume_frontend_post_command('${request}');raise exception 'foreign command accepted'; exception when insufficient_privilege then null;end;
      input:=jsonb_set(input-'target_id'-'expected_revision','{request_id}',to_jsonb('${otherRequest}'::text));
      input:=input||jsonb_build_object('context',jsonb_build_object('kind','listing','area','market','category','jobs_services','activity',null),
        'attributes',jsonb_build_object('job_type','full_time','location_type','on_site'),'listing_terms',jsonb_build_object('price',jsonb_build_object('mode','on_request'),'negotiable',false),
        'media','[]'::jsonb,'presentation_media','[]'::jsonb);
      perform api.stage_frontend_post_command('${unverified.id}','${otherRequest}',repeat('a',64),input);
      select count(*) into total from private.posts where owner_id='${unverified.id}';
      begin perform api.consume_frontend_post_command('${otherRequest}');raise exception 'unverified publication accepted'; exception when insufficient_privilege then null;end;
      if (select count(*) from private.posts where owner_id='${unverified.id}')<>total then raise exception 'failed submission left a post'; end if;
      update private.frontend_post_commands set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where request_id='${otherRequest}';
      insert into private.legal_holds(subject_id,reason,placed_by) values('${unverified.id}','Synthetic hold','${reviewer.id}');
      perform api.run_retention(100);
      if (select payload from private.frontend_post_commands where request_id='${otherRequest}')='{"expired":true}'::jsonb then raise exception 'retention ignored hold'; end if;
      update private.legal_holds set released_at=clock_timestamp(),released_by='${reviewer.id}' where subject_id='${unverified.id}' and released_at is null;
      perform api.run_retention(100);
      if (select payload from private.frontend_post_commands where request_id='${otherRequest}')<>'{"expired":true}'::jsonb then raise exception 'expired form payload retained'; end if;
      if has_function_privilege('anon','api.consume_frontend_post_command(uuid)','execute')
        or has_function_privilege('service_role','api.consume_frontend_post_command(uuid)','execute')
        or has_function_privilege('authenticated','api.stage_frontend_post_command(uuid,uuid,text,jsonb)','execute')
        or has_function_privilege('anon','api.stage_frontend_post_command(uuid,uuid,text,jsonb)','execute')
        or has_table_privilege('authenticated','private.post_presentations','select') then raise exception 'form command audience widened'; end if;
      c:=api.reserve_frontend_verification_upload(gen_random_uuid(),'id_front',repeat('a',64),'Fixture','Member');
      if not exists(select 1 from private.frontend_verification_uploads where artifact_id=(c->>'artifact_id')::uuid) then raise exception 'transport receipt missing'; end if;
      delete from private.evidence_artifacts where id=(c->>'artifact_id')::uuid;
      if exists(select 1 from private.frontend_verification_uploads where artifact_id=(c->>'artifact_id')::uuid) then raise exception 'transport receipt survived evidence deletion'; end if;
      if exists(select 1 from pg_constraint where conrelid='private.frontend_verification_uploads'::regclass and contype='f' and confrelid<>'auth.users'::regclass and confdeltype<>'c') then raise exception 'transport receipts block native history retention'; end if;
      delete from private.post_presentation_media where object_id=(poster->>'object_id')::uuid;
      if (select unlinked_at from private.media_objects where id=(poster->>'object_id')::uuid) is null then raise exception 'presentation media grace period missing'; end if;
    end $fixture$;
    select value from restored_owner_form_probe;
    select 'NATIVE_POST_COMMANDS_PASS';
    rollback;
  `);
  assert.ok(outcome.includes("NATIVE_POST_COMMANDS_PASS"));
  const restored = parseRestoredOwnerPost(
    JSON.parse(outcome.split("\n").find((line) => line.startsWith("{")))
  );
  assert.equal(
    restoredOwnerPostRow(restored, owner.id).location_address,
    "Updated fixture address"
  );
  assert.equal(sql("select to_regclass('private.frontend_post_commands') is null;"), "t");
  report.checks.push(
    "listing/business/event form commands",
    "create/submit/trial once",
    "owned ready logo and poster retained",
    "native independent moderation",
    "live edit isolation and presentation merge",
    "presentation edit consumes edit budget",
    "public visibility applied before presentation",
    "self-only owner form/list restoration",
    "foreign/unverified command refusal",
    "failed command leaves no draft",
    "expired command payload scrub and legal hold protection",
    "exact owner/service command grants",
    "DDL and all posting/verification fixture changes rolled back"
  );
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.stage = stage;
  report.sqlState = String(error.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null;
  report.diagnostic =
    String(error.stderr ?? error.message)
      .split("\n")
      .find((line) => line.includes("ERROR:"))
      ?.replace(/^.*ERROR:\s*/, "")
      .slice(0, 400) ?? "Fixture assertion failed; credentials withheld";
  process.exitCode = 1;
} finally {
  for (const account of tracked) {
    const removed = await admin.auth.admin.deleteUser(account.id);
    if (removed.error) {
      report.status = "FAIL";
      report.cleanup = "Auth fixture removal incomplete";
      process.exitCode = 1;
    }
  }
  try {
    assert.equal(sql("select count(*) from auth.users;"), "0");
    report.cleanup = "PASS local Auth users removed";
  } catch {
    report.status = "FAIL";
    process.exitCode = 1;
  }
  release();
  mkdirSync("tmp/backend-reconciliation", { recursive: true });
  writeFileSync(
    "tmp/backend-reconciliation/native-post-commands.json",
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report));
}

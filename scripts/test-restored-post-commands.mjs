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
  postingAllowanceSchema,
  restoredPostingPlanInfo,
} from "../src/lib/foundation/posting-allowance.ts";
import { parseStaffModerationQueue } from "../src/lib/foundation/staff-moderation-queue.ts";
import { foundationEvidenceMetadataSchema } from "../src/lib/foundation/evidence-metadata.ts";
import { frontendIdentityContextSchema } from "../src/lib/foundation/identity-review-contract.ts";
import {
  readFoundationOwnerDashboard,
  dashboardVerificationSteps,
} from "../src/lib/foundation/owner-dashboard.ts";
import { readFrontendStaffVerificationQueue } from "../src/lib/foundation/staff-verification-queue.ts";
import { readRestoredGovernance } from "../src/lib/foundation/governance.ts";
import {
  readFrontendFeatureFlags,
  readFrontendFeatureConfig,
  readFrontendGovernanceMetrics,
} from "../src/lib/foundation/feature-controls.ts";
import { validateSaIdChecksum } from "../src/lib/utils/sa-id-validation.ts";
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
    unverified = await user("unverified"),
    governor = await user("governor"),
    administrator = await user("administrator");
  stage = "real local reviewer TOTP";
  async function verifyTotp(account) {
    const enrolled = await account.client.auth.mfa.enroll({ factorType: "totp" });
    assert.equal(enrolled.error, null);
    const challenge = await account.client.auth.mfa.challenge({ factorId: enrolled.data.id });
    assert.equal(challenge.error, null);
    const verified = await account.client.auth.mfa.verify({
      factorId: enrolled.data.id,
      challengeId: challenge.data.id,
      code: nativeTotp(enrolled.data.totp.secret),
    });
    assert.equal(verified.error, null);
    account.claims = JSON.parse(
      Buffer.from(
        (await account.client.auth.getSession()).data.session.access_token.split(".")[1],
        "base64url"
      )
    );
    assert.equal(account.claims.aal, "aal2");
  }
  await verifyTotp(reviewer);
  await verifyTotp(governor);
  await verifyTotp(administrator);
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
  const identityKeys = {
    identityMatchKey: randomBytes(32).toString("hex"),
    numberEncryptionKey: randomBytes(32).toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  };
  const identity = processIdentityNumber(owner.id, "8001015009087", identityKeys);
  const secondNumber = Array.from({ length: 10 }, (_, n) => `900101500908${n}`).find(
    validateSaIdChecksum
  );
  assert.ok(secondNumber);
  const otherIdentity = processIdentityNumber(unverified.id, secondNumber, identityKeys);
  const otherIdentityReceipt = {
    fingerprint: otherIdentity.fingerprint,
    encrypted_number: otherIdentity.encryptedNumber,
  };
  const overlay = (file) =>
    readFileSync(file, "utf8")
      .replace(/^begin;\s*$/gm, "")
      .replace(/^commit;\s*$/gm, "");
  const files = [
    "database/foundation/updates/20261029191349_restore_public_browse_contract.sql",
    "database/foundation/updates/20261104000046_restored_verification_transport.sql",
    "database/foundation/updates/20261104001222_restore_full_admin_capabilities.sql",
    "database/foundation/updates/20261103180512_restored_owner_dashboard.sql",
    "database/foundation/updates/20261103183017_repair_dashboard_identity_lookup.sql",
    "database/foundation/updates/20261104002445_restored_post_commands.sql",
    "database/foundation/updates/20261104042501_preserve_existing_edit_consent.sql",
    "database/foundation/updates/20261104043441_restored_post_manager.sql",
    "database/foundation/updates/20261104044439_preserve_post_contact_privacy.sql",
    "database/foundation/updates/20261104045254_align_frontend_receipt_retention.sql",
    "database/foundation/updates/20261104052154_repeatable_frontend_media_uploads.sql",
    "database/foundation/updates/20261104101932_restored_owner_post_actions.sql",
    "database/foundation/updates/20261104105223_preserve_nonlive_edit_flow.sql",
    "database/foundation/updates/20261104105449_enforce_nonlive_review_budget.sql",
    "database/foundation/updates/20261104110442_restored_posting_allowance.sql",
    "database/foundation/updates/20261104111941_restored_staff_moderation_queue.sql",
    "database/foundation/updates/20261104155022_restored_staff_claim_controls.sql",
    "database/foundation/updates/20261104162910_preserved_identity_review_workflow.sql",
    "database/foundation/updates/20261104214751_preserve_reviewed_identity_status.sql",
    "database/foundation/updates/20261104214932_restored_governance_decisions.sql",
    "database/foundation/updates/20261104220316_restored_runtime_controls.sql",
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
    insert into private.staff_roles(user_id,role,granted_by) values('${governor.id}','governor','${owner.id}');
    insert into private.staff_roles(user_id,role,granted_by) values('${administrator.id}','admin','${owner.id}');
    create temporary table restored_owner_form_probe(value jsonb);
    create temporary table restored_allowance_probe(value jsonb);
    create temporary table restored_staff_queue_probe(value jsonb);
    create temporary table restored_evidence_metadata_probe(value jsonb);
    create temporary table restored_identity_context_probe(value jsonb);
    create temporary table restored_identity_queue_probe(value jsonb);
    create temporary table restored_owner_identity_probe(kind text,value jsonb);
    create temporary table restored_governance_probe(value jsonb);
    create temporary table restored_controls_probe(kind text,value jsonb);
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
      answer jsonb; again jsonb; edited jsonb; rev integer; total integer;move_request uuid;queue_case jsonb;case_lease jsonb;id_request uuid;selfie_request uuid;identity_pair jsonb;
    begin
      ${claims(owner)}
      begin perform api.get_frontend_staff_moderation_queue();raise exception 'member read staff queue';exception when insufficient_privilege then null;end;
      c:=api.get_my_frontend_posting_allowance('market');
      if c->>'capacity'<>'0' or c->'trial_offer'->>'eligible'<>'true' or c->>'trial_used'<>'false' then raise exception 'initial trial allowance drift';end if;
      insert into restored_allowance_probe values(c);
      begin perform api.get_my_frontend_posting_allowance('project');raise exception 'unsupported program accepted';exception when invalid_parameter_value then null;end;
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
      insert into restored_evidence_metadata_probe values(api.staff_evidence_metadata((c->>'case_id')::uuid,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,'routine_review'));
      proof:=api.get_frontend_staff_verification_queue();
      if proof->>'total_steps'<>'2' or jsonb_array_length(proof->'groups'->0->'steps')<>2 then raise exception 'native identity queue lost paired review steps';end if;
      insert into restored_identity_queue_probe values(proof);
      proof:=api.get_frontend_staff_identity_context('${owner.id}',null);
      if proof->>'submission_id'<>submission->>'submission_id' then raise exception 'identity context resolved another submission';end if;
      insert into restored_identity_context_probe values(proof);
      begin perform api.approve_frontend_identity_step((c->>'case_id')::uuid,(submission->>'submission_id')::uuid,(i->>'artifact_id')::uuid,(submission->>'case_version')::integer,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,false);raise exception 'implicit document match accepted';exception when invalid_parameter_value then null;end;
      proof:=api.approve_frontend_identity_step((c->>'case_id')::uuid,(submission->>'submission_id')::uuid,(i->>'artifact_id')::uuid,(submission->>'case_version')::integer,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true);
      if proof->>'status'<>'step_approved' or exists(select 1 from private.accepted_identity_facts where owner_id='${owner.id}') or internal.current_verified_identity('${owner.id}') is not null then raise exception 'one step approval granted verified identity';end if;
      proof:=api.get_frontend_staff_verification_queue();
      if proof->>'total_steps'<>'1' or proof->'groups'->0->'steps'->0->>'step_type'<>'selfie' then raise exception 'identity queue did not preserve separate approvals';end if;
      insert into restored_identity_queue_probe values(proof);
      ${claims(governor)}
      begin perform api.get_frontend_staff_identity_context('${owner.id}',null);raise exception 'unheld private identity context exposed';exception when insufficient_privilege then null;end;
      ${claims(reviewer)}
      proof:=api.approve_frontend_identity_step((c->>'case_id')::uuid,(submission->>'submission_id')::uuid,(face->>'artifact_id')::uuid,(submission->>'case_version')::integer,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true);
      if proof->>'status'<>'accepted' then raise exception 'native review did not accept synthetic evidence'; end if;
      proof:=api.approve_frontend_identity_step((c->>'case_id')::uuid,(submission->>'submission_id')::uuid,(face->>'artifact_id')::uuid,(submission->>'case_version')::integer,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true);
      if proof->>'reused'<>'true' or (select count(*) from private.accepted_identity_facts where owner_id='${owner.id}')<>1 then raise exception 'identity approval reply replayed a mutation';end if;
      begin perform api.approve_frontend_identity_step((c->>'case_id')::uuid,(submission->>'submission_id')::uuid,(face->>'artifact_id')::uuid,(submission->>'case_version')::integer,lease->>'claim_generation',gen_random_uuid(),true);raise exception 'approval acknowledgement accepted another nonce';exception when insufficient_privilege then null;end;
      ${claims(owner)}
      if api.get_my_frontend_identity_state()->>'identity_reviewed_at' is null or api.get_my_verification_case()->>'verified'<>'false' then raise exception 'accepted identity depends on later phone/locality steps';end if;
      insert into restored_owner_identity_probe values('dashboard',api.get_my_dashboard()),('identity',api.get_my_frontend_identity_state());
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
      c:=api.get_my_frontend_posting_allowance('market');
      if c->>'capacity'<>'1' or c->>'used'<>'1' or c->>'tier'<>'active' or c->>'trial_used'<>'true' or c->'trial_offer'->>'eligible'<>'false' then raise exception 'actual trial capacity drift';end if;
      insert into restored_allowance_probe values(c);
      if not internal.media_object_in_use((logo->>'object_id')::uuid) or not internal.media_object_in_use((poster->>'object_id')::uuid) then raise exception 'supplemental media omitted from retention'; end if;
      if (select payload from private.frontend_post_commands where request_id='${request}') is not null then raise exception 'redundant command payload retained'; end if;
      ${claims(reviewer)}
      c:=api.get_frontend_staff_moderation_queue();
      if c->>'total'<>'1' or c->'items'->0->'review'<>'null'::jsonb or c->'items'->0->'owner_id'<>'null'::jsonb then raise exception 'unclaimed submitted body exposed';end if;
      insert into restored_staff_queue_probe values(c);
      lease:=api.claim_queue_item('post',(answer->>'id')::uuid);
      ${claims(unverified)}
      queue_case:=api.open_verification_case();
      ${claims(reviewer)}
      case_lease:=api.claim_evidence_case((queue_case->>'case_id')::uuid);
      c:=api.get_frontend_staff_claims();
      if c->>'own_count'<>'2' or jsonb_array_length(c->'items')<>2 then raise exception 'mixed own claim snapshot drift';end if;
      begin perform api.get_frontend_staff_claims('[{"type":null,"id":"${request}"}]'::jsonb);raise exception 'null claim type accepted';exception when invalid_parameter_value then null;end;
      ${claims(governor)}
      c:=api.get_frontend_staff_claims(jsonb_build_array(jsonb_build_object('type','listing','id',answer->>'id'),jsonb_build_object('type','verification_step','id',queue_case->>'case_id')));
      if c->>'own_count'<>'0' or jsonb_array_length(c->'items')<>2 or exists(select 1 from jsonb_array_elements(c->'items')x where x->'generation'<>'null'::jsonb or x->'nonce'<>'null'::jsonb or x->>'mine'<>'false') then raise exception 'foreign lease secret exposed';end if;
      perform api.reassign_frontend_staff_claim('verification_step',(queue_case->>'case_id')::uuid,null,'Synthetic queue handoff');
      if (select count(*) from private.frontend_evidence_claim_events where case_id=(queue_case->>'case_id')::uuid)<>1 then raise exception 'evidence handoff unaudited';end if;
      ${claims(reviewer)}
      begin perform api.renew_evidence_claim((queue_case->>'case_id')::uuid,case_lease->>'claim_generation',(case_lease->>'claim_nonce')::uuid);raise exception 'released lease renewed';exception when insufficient_privilege then null;end;
      case_lease:=api.claim_evidence_case((queue_case->>'case_id')::uuid);
      ${claims(governor)}
      begin perform api.reassign_frontend_staff_claim('verification_step',(queue_case->>'case_id')::uuid,'${unverified.id}','Synthetic self review');raise exception 'case assigned to its subject';exception when insufficient_privilege then null;end;
      perform api.reassign_frontend_staff_claim('verification_step',(queue_case->>'case_id')::uuid,'${governor.id}','Synthetic independent assignment');
      perform api.reassign_frontend_staff_claim('verification_step',(queue_case->>'case_id')::uuid,'${reviewer.id}','Synthetic independent handback');
      ${claims(reviewer)}
      if api.control_my_frontend_staff_claims('renew')->>'renewed'<>'2' then raise exception 'mixed renewal failed';end if;
      if api.control_my_frontend_staff_claims('release')->>'released'<>'2' or api.get_frontend_staff_claims()->>'own_count'<>'0' then raise exception 'mixed release failed';end if;
      c:=api.claim_frontend_staff_items('content',10);lease:=c->'items'->0;
      if c->>'lease_minutes'<>'15' or jsonb_array_length(c->'items')<>1 then raise exception 'native content batch claim drift';end if;
      c:=api.claim_frontend_staff_items('kyc',10);
      if jsonb_array_length(c->'items')<>0 or c->>'lease_minutes'<>'30' then raise exception 'unsubmitted evidence case entered review queue';end if;
      c:=api.get_frontend_staff_moderation_queue();
      if c->>'my_claims'<>'1' or c->'items'->0->'review'->>'id'<>answer->>'id' or c->'items'->0->'claim'->>'nonce'<>lease->>'claim_nonce' then raise exception 'claimed moderation context drift';end if;
      insert into restored_staff_queue_probe values(c);
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
      move_request:=gen_random_uuid();
      edited:=api.execute_my_frontend_post_action(move_request,(answer->>'id')::uuid,rev,'deactivate','listing','market');
      if edited<>api.execute_my_frontend_post_action(move_request,(answer->>'id')::uuid,rev,'deactivate','listing','market') then raise exception 'deactivation receipt changed';end if;
      rev:=(edited->>'revision')::integer;move_request:=gen_random_uuid();
      edited:=api.execute_my_frontend_post_action(move_request,(answer->>'id')::uuid,rev,'reactivate','listing','market');
      if edited->>'status'<>'live' or edited<>api.execute_my_frontend_post_action(move_request,(answer->>'id')::uuid,rev,'reactivate','listing','market') then raise exception 'unchanged approved reactivation failed';end if;
      rev:=(edited->>'revision')::integer;
      perform api.execute_my_frontend_post_action(gen_random_uuid(),(answer->>'id')::uuid,rev,'deactivate','listing','market');
      select revision into rev from private.posts where id=(answer->>'id')::uuid;
      input:=input||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',rev);
      input:=jsonb_set(input,'{content,title}','"Saved inactive content awaiting explicit resubmission"');
      perform api.stage_frontend_post_command('${owner.id}',(input->>'request_id')::uuid,repeat('9',64),input);
      edited:=api.consume_frontend_post_command((input->>'request_id')::uuid);
      if edited->>'status'<>'paused' then raise exception 'saving inactive content implicitly resubmitted it';end if;
      again:=api.search_post_cards(jsonb_build_object('post_id',answer->>'id','offset',0,'limit',1,'presentation',true,'frontend_presentation',true));
      if jsonb_array_length(again->'items')<>0 then raise exception 'paused post leaked public presentation'; end if;
      business_input:=jsonb_set(business_input,'{media,0,object_key}',picture->'object_key');
      business_input:=jsonb_set(business_input,'{presentation_media,0,object_key}',logo->'object_key');
      business_input:=pg_temp.bind_frontend_media(business_input);
      perform api.stage_frontend_post_command('${owner.id}','${businessRequest}',repeat('b',64),business_input);
      again:=api.consume_frontend_post_command('${businessRequest}');
      if again->>'status'<>'pending_moderation' or api.get_my_frontend_post((again->>'id')::uuid)->'frontend'->'data'->'services_offered'->>0<>'Example service' then raise exception 'business form data lost'; end if;
      proof:=again;
      event_input:=jsonb_set(event_input,'{media,0,object_key}',picture->'object_key');
      event_input:=pg_temp.bind_frontend_media(event_input);
      event_input:=jsonb_set(event_input,'{presentation,business_id}',again->'id');
      perform api.stage_frontend_post_command('${owner.id}','${eventRequest}',repeat('c',64),event_input);
      again:=api.consume_frontend_post_command('${eventRequest}');
      if again->>'status'<>'pending_moderation' or api.get_my_frontend_post((again->>'id')::uuid)->'frontend'->'data'->'event_details'->>'venue_name'<>'Fixture venue' then raise exception 'event form data lost'; end if;
      c:=api.get_my_frontend_post_manager();
      if c->>'account_id'<>'${owner.id}' or c->'slot_usage'->0->>'activeUsage'<>'1' or c->'slot_usage'->0->>'activationCount'<>'3' then raise exception 'native manager allowance facts changed'; end if;
      if api.get_my_frontend_post((again->>'id')::uuid)->>'expires_at' is null then raise exception 'pending event lost actual end time'; end if;
      move_request:=gen_random_uuid();
      c:=api.execute_my_frontend_post_action(move_request,(proof->>'id')::uuid,(proof->>'revision')::integer,'delete','business','business');
      if c->>'status'<>'deleted' or c<>api.execute_my_frontend_post_action(move_request,(proof->>'id')::uuid,(proof->>'revision')::integer,'delete','business','business') then raise exception 'delete retry lost its receipt';end if;
      begin perform api.execute_my_frontend_post_action(gen_random_uuid(),(answer->>'id')::uuid,1,'deactivate','listing','market');raise exception 'stale owner action accepted';exception when sqlstate 'PT409' then null;end;
      select revision into rev from private.posts where id=(answer->>'id')::uuid;
      c:=api.save_post_content((answer->>'id')::uuid,rev,jsonb_build_object('title','Changed content requiring independent review'));
      c:=api.execute_my_frontend_post_action(gen_random_uuid(),(answer->>'id')::uuid,(c->>'revision')::integer,'reactivate','listing','market');
      if c->>'status'<>'pending_moderation' then raise exception 'changed content was published without review';end if;
      ${claims(reviewer)}
      lease:=api.claim_queue_item('post',(answer->>'id')::uuid);
      perform api.moderate_post((answer->>'id')::uuid,(c->>'revision')::integer,'approve',lease->>'claim_generation',(lease->>'claim_nonce')::uuid,null);
      if internal.approved_edit_count((answer->>'id')::uuid)<>2 then raise exception 'offline content edit escaped the approved edit count';end if;
      ${claims(owner)}
      select revision into rev from private.posts where id=(answer->>'id')::uuid;
      c:=api.execute_my_frontend_post_action(gen_random_uuid(),(answer->>'id')::uuid,rev,'deactivate','listing','market');
      c:=api.save_post_content((answer->>'id')::uuid,(c->>'revision')::integer,jsonb_build_object('title','One change beyond the approved edit allowance'));
      c:=api.execute_my_frontend_post_action(gen_random_uuid(),(answer->>'id')::uuid,(c->>'revision')::integer,'reactivate','listing','market');
      ${claims(reviewer)}
      lease:=api.claim_queue_item('post',(answer->>'id')::uuid);
      begin perform api.moderate_post((answer->>'id')::uuid,(c->>'revision')::integer,'approve',lease->>'claim_generation',(lease->>'claim_nonce')::uuid,null);
        raise exception 'offline review bypassed the edit allowance';exception when sqlstate 'PT409' then null;end;
      perform api.moderate_post((answer->>'id')::uuid,(c->>'revision')::integer,'reject',lease->>'claim_generation',(lease->>'claim_nonce')::uuid,'Synthetic rejected over-budget edit');
      ${claims(owner)}
      select revision into rev from private.posts where id=(answer->>'id')::uuid;
      input:=input||jsonb_build_object('request_id',gen_random_uuid(),'expected_revision',rev);
      input:=jsonb_set(input,'{content,title}','"Changed content requiring independent review"');
      input:=jsonb_set(input,'{listing_terms,price}',jsonb_build_object('mode','amount','amount_cents',13000));
      perform api.stage_frontend_post_command('${owner.id}',(input->>'request_id')::uuid,repeat('8',64),input);
      c:=api.consume_frontend_post_command((input->>'request_id')::uuid);
      if c->>'status'<>'rejected' then raise exception 'editing a rejected post implicitly resubmitted it';end if;
      c:=api.execute_my_frontend_post_action(gen_random_uuid(),(answer->>'id')::uuid,(c->>'revision')::integer,'resubmit','listing','market');
      ${claims(reviewer)}
      lease:=api.claim_queue_item('post',(answer->>'id')::uuid);
      perform api.moderate_post((answer->>'id')::uuid,(c->>'revision')::integer,'approve',lease->>'claim_generation',(lease->>'claim_nonce')::uuid,null);
      if internal.approved_edit_count((answer->>'id')::uuid)<>2 or not internal.recent_price_change((answer->>'id')::uuid) then raise exception 'offline price-only policy drift';end if;
      ${claims(unverified)}
      begin perform api.execute_my_frontend_post_action(gen_random_uuid(),(answer->>'id')::uuid,1,'delete','listing','market');raise exception 'foreign owner action accepted';exception when insufficient_privilege then null;end;
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
      if has_function_privilege('anon','api.get_my_frontend_posting_allowance(text)','execute') or has_function_privilege('service_role','api.get_my_frontend_posting_allowance(text)','execute') then raise exception 'posting allowance audience widened';end if;
      c:=api.reserve_frontend_verification_upload(gen_random_uuid(),'id_front',repeat('a',64),'Fixture','Member');
      if not exists(select 1 from private.frontend_verification_uploads where artifact_id=(c->>'artifact_id')::uuid) then raise exception 'transport receipt missing'; end if;
      delete from private.evidence_artifacts where id=(c->>'artifact_id')::uuid;
      if exists(select 1 from private.frontend_verification_uploads where artifact_id=(c->>'artifact_id')::uuid) then raise exception 'transport receipt survived evidence deletion'; end if;
      if exists(select 1 from pg_constraint where conrelid='private.frontend_verification_uploads'::regclass and contype='f' and confrelid<>'auth.users'::regclass and confdeltype<>'c') then raise exception 'transport receipts block native history retention'; end if;
      delete from private.post_presentation_media where object_id=(poster->>'object_id')::uuid;
      if (select unlinked_at from private.media_objects where id=(poster->>'object_id')::uuid) is null then raise exception 'presentation media grace period missing'; end if;

      -- A returned wizard pair cannot reuse an old selfie after a new ID bumps
      -- the case version. All receipts below remain explicitly synthetic.
      ${claims(unverified)}
      perform api.save_my_legal_name((api.get_my_profile()->>'revision')::integer,'Fixture','Member');
      id_request:=gen_random_uuid();selfie_request:=gen_random_uuid();
      i:=api.reserve_frontend_verification_upload(id_request,'id_front',repeat('1',64),'Fixture','Member');
      c:=api.frontend_verification_upload_context('${unverified.id}',id_request);i:=i||jsonb_build_object('case_id',c->'case_id');
      perform api.complete_frontend_verification_upload('${unverified.id}',id_request,repeat('1',64),repeat('2',64),128,'${JSON.stringify(otherIdentityReceipt)}'::jsonb,0);
      face:=api.reserve_frontend_verification_upload(selfie_request,'selfie',repeat('3',64));
      perform api.complete_frontend_verification_upload('${unverified.id}',selfie_request,repeat('3',64),repeat('4',64),128,null,0);
      select v.submission_id into move_request from private.verification_current_submissions v where v.case_id=(i->>'case_id')::uuid;
      select s.case_version into rev from private.verification_identity_submissions s where s.id=move_request;
      ${claims(reviewer)}
      lease:=api.claim_evidence_case((i->>'case_id')::uuid);
      proof:=api.return_frontend_identity_step((i->>'case_id')::uuid,move_request,(i->>'artifact_id')::uuid,rev,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,'rejected','Synthetic ID rejection: retake the complete pair');
      ${claims(unverified)}
      if api.get_my_frontend_identity_state()->>'decision'<>'rejected' or jsonb_array_length(api.get_my_frontend_verification_uploads())<>0 then raise exception 'rejected wizard receipts still completed';end if;
      begin perform api.reserve_frontend_verification_upload(selfie_request,'selfie',repeat('3',64));raise exception 'returned upload receipt reused';exception when sqlstate 'PT409' then null;end;
      id_request:=gen_random_uuid();
      i:=api.reserve_frontend_verification_upload(id_request,'id_front',repeat('5',64),'Fixture','Member');
      c:=api.frontend_verification_upload_context('${unverified.id}',id_request);i:=i||jsonb_build_object('case_id',c->'case_id');
      perform api.complete_frontend_verification_upload('${unverified.id}',id_request,repeat('5',64),repeat('6',64),128,'${JSON.stringify(otherIdentityReceipt)}'::jsonb,0);
      c:=api.get_my_frontend_verification_uploads();
      if jsonb_array_length(c)<>1 or c->0->>'purpose'<>'id_front' then raise exception 'old selfie reappeared after new ID';end if;
      selfie_request:=gen_random_uuid();face:=api.reserve_frontend_verification_upload(selfie_request,'selfie',repeat('7',64));
      perform api.complete_frontend_verification_upload('${unverified.id}',selfie_request,repeat('7',64),repeat('8',64),128,null,75);
      select v.submission_id into move_request from private.verification_current_submissions v where v.case_id=(i->>'case_id')::uuid;
      select s.case_version into rev from private.verification_identity_submissions s where s.id=move_request;
      ${claims(reviewer)}
      lease:=api.claim_evidence_case((i->>'case_id')::uuid);
      begin perform api.approve_frontend_identity_step((i->>'case_id')::uuid,move_request,(i->>'artifact_id')::uuid,rev,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true,null,'supporting_evidence');raise exception 'routine-only role proposed high-risk override';exception when insufficient_privilege then null;end;
      perform api.release_evidence_claim((i->>'case_id')::uuid,lease->>'claim_generation',(lease->>'claim_nonce')::uuid);
      ${claims(administrator)}
      lease:=api.claim_evidence_case((i->>'case_id')::uuid);
      begin perform api.approve_frontend_identity_step((i->>'case_id')::uuid,move_request,(i->>'artifact_id')::uuid,rev,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true);raise exception 'high-risk justification omitted';exception when invalid_parameter_value then null;end;
      perform api.approve_frontend_identity_step((i->>'case_id')::uuid,move_request,(i->>'artifact_id')::uuid,rev,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true,null,'supporting_evidence');
      proof:=api.approve_frontend_identity_step((i->>'case_id')::uuid,move_request,(face->>'artifact_id')::uuid,rev,lease->>'claim_generation',(lease->>'claim_nonce')::uuid,true,null,'supporting_evidence');
      if proof->>'status'<>'awaiting_second_reviewer' or exists(select 1 from private.accepted_identity_facts where owner_id='${unverified.id}') then raise exception 'high-risk step approvals bypassed independent review';end if;
      begin perform api.approve_decision((proof->>'decision_id')::uuid);raise exception 'proposer approved own high-risk decision';exception when insufficient_privilege then null;end;
      begin perform api.decide_frontend_governance((proof->>'decision_id')::uuid,(i->>'case_id')::uuid,rev,rev,'approve','Synthetic self approval');raise exception 'frontend proposer approved own high-risk decision';exception when insufficient_privilege then null;end;
      perform api.decide_frontend_governance((proof->>'decision_id')::uuid,(i->>'case_id')::uuid,rev,rev,'escalate','Synthetic escalation to an independent reviewer');
      ${claims(governor)}
      begin perform api.decide_frontend_governance((proof->>'decision_id')::uuid,(i->>'case_id')::uuid,rev,rev,'approve','Synthetic independent approval');raise exception 'unheld independent identity approval accepted';exception when insufficient_privilege then null;end;
      perform api.reassign_frontend_staff_claim('verification_step',(i->>'case_id')::uuid,'${governor.id}','Synthetic independent evidence review');
      c:=api.get_frontend_staff_identity_context('${unverified.id}',null);
      insert into restored_governance_probe values(api.get_frontend_governance_page(jsonb_build_object('id',proof->>'decision_id','status','all')));
      begin perform api.decide_frontend_governance((proof->>'decision_id')::uuid,(i->>'case_id')::uuid,rev+1,rev,'approve','Synthetic independent approval');raise exception 'changed represented version approved';exception when sqlstate 'PT409' then null;end;
      answer:=api.decide_frontend_governance((proof->>'decision_id')::uuid,(i->>'case_id')::uuid,rev,rev,'approve','Synthetic independent approval');
      if answer->>'status'<>'approved' then raise exception 'governance approval missing';end if;
      answer:=api.decide_frontend_governance((proof->>'decision_id')::uuid,(i->>'case_id')::uuid,rev,rev,'approve','Synthetic independent approval');
      if answer->>'reused'<>'true' then raise exception 'governance acknowledgement was not retry-safe';end if;
      insert into restored_governance_probe values(api.get_frontend_governance_page(jsonb_build_object('id',proof->>'decision_id','status','all')));
      if (select count(*) from private.accepted_identity_facts where owner_id='${unverified.id}' and second_reviewer='${governor.id}')<>1 then raise exception 'independent high-risk approval missing';end if;
      -- Non-granting rejection closes the retained proposal only. An authored
      -- withdrawal still uses the canonical withdrawal authority.
      insert into private.evidence_cases(subject_id,kind) values('${owner.id}','restriction') returning id into move_request;
      ${claims(administrator)}
      case_lease:=api.propose_decision(move_request,1,'restrict_account','{}');
      ${claims(owner)}
      begin perform api.decide_frontend_governance((case_lease->>'decision_id')::uuid,move_request,1,1,'reject','Synthetic subject rejection');raise exception 'subject decided own restriction';exception when insufficient_privilege then null;end;
      ${claims(reviewer)}
      begin perform api.get_frontend_governance_page();raise exception 'moderator read governance';exception when insufficient_privilege then null;end;
      begin perform api.decide_frontend_governance((case_lease->>'decision_id')::uuid,move_request,1,1,'reject','Synthetic unauthorized rejection');raise exception 'moderator decided governance';exception when insufficient_privilege then null;end;
      ${claims(governor)}
      answer:=api.decide_frontend_governance((case_lease->>'decision_id')::uuid,move_request,1,1,'reject','Synthetic independent rejection');
      if answer->>'status'<>'rejected' or not exists(select 1 from private.current_account_access where id='${owner.id}') then raise exception 'rejection applied proposed restriction';end if;
      answer:=api.decide_frontend_governance((case_lease->>'decision_id')::uuid,move_request,1,1,'reject','Synthetic independent rejection');
      if answer->>'reused'<>'true' then raise exception 'rejection acknowledgement not retry-safe';end if;
      begin perform api.decide_frontend_governance((case_lease->>'decision_id')::uuid,move_request,1,1,'reject','Different rejection rationale');raise exception 'rejection audit mutated';exception when sqlstate 'PT409' then null;end;
      begin perform api.approve_decision((case_lease->>'decision_id')::uuid);raise exception 'rejected proposal approved later';exception when invalid_parameter_value then null;end;
      insert into restored_governance_probe values(api.get_frontend_governance_page(jsonb_build_object('id',case_lease->>'decision_id','status','all')));
      insert into restored_controls_probe values('config',api.read_frontend_feature_config());
      begin perform api.get_frontend_feature_flags();raise exception 'governor managed admin display settings';exception when insufficient_privilege then null;end;
      ${claims(administrator)}
      c:=api.get_frontend_feature_flags();
      if c->'flags'->0->>'mode'<>'off' then raise exception 'optional desk flag changed selected default';end if;
      begin perform api.set_frontend_feature_flag('staff_mfa_enforced',1,'off',0,'{}','Attempt to disable required MFA');raise exception 'mandatory MFA treated as display flag';exception when invalid_parameter_value then null;end;
      answer:=api.set_frontend_feature_flag('kyc_evidence_desk',1,'allowlist',0,array['moderator','admin'],'Synthetic reviewer canary');
      if answer->'flags'->0->>'revision'<>'2' then raise exception 'display flag revision not advanced';end if;
      if api.set_frontend_feature_flag('kyc_evidence_desk',1,'allowlist',0,array['admin','moderator'],'Synthetic reviewer canary') is distinct from answer then raise exception 'display flag retry acknowledgement changed';end if;
      if (select count(*) from private.frontend_feature_flag_events)<>1 then raise exception 'display flag audit repeated';end if;
      begin perform api.set_frontend_feature_flag('kyc_evidence_desk',1,'on',100,'{}','Stale display configuration');raise exception 'stale display update overwrote revision';exception when sqlstate 'PT409' then null;end;
      insert into restored_controls_probe values('flags',answer);
      if has_table_privilege('authenticated','private.frontend_feature_flags','select') or has_table_privilege('service_role','private.frontend_feature_flags','update') or has_function_privilege('authenticated','api.read_frontend_feature_config()','execute') or has_function_privilege('service_role','api.set_frontend_feature_flag(text,integer,text,integer,text[],text)','execute') then raise exception 'display controls crossed role boundary';end if;
      ${claims(administrator)}
      case_lease:=api.propose_decision(move_request,1,'restrict_account','{}');
      answer:=api.decide_frontend_governance((case_lease->>'decision_id')::uuid,move_request,1,1,'reject','Synthetic authored withdrawal');
      if answer->>'status'<>'withdrawn' then raise exception 'authored rejection did not remain withdrawal';end if;
      ${claims(governor)}
      insert into restored_governance_probe values(api.get_frontend_governance_page(jsonb_build_object('id',case_lease->>'decision_id','status','all')));
      insert into restored_controls_probe values('metrics',api.get_frontend_governance_metrics());
      -- Retention changes the files, not the accepted review. These fixtures
      -- never write actual objects; native state transitions still enforce
      -- their terminal-state and verification-invalidation rules.
      update private.evidence_artifacts set retain_until=statement_timestamp()-interval '1 second' where owner_id='${owner.id}' and purpose in('id_front','selfie');
      proof:=api.claim_evidence_cleanup(100);
      if (select count(*) from private.evidence_artifacts where owner_id='${owner.id}' and state='cleanup_required')<>2 then raise exception 'retention fixture did not retire both accepted files';end if;
      ${claims(owner)}
      if api.get_my_frontend_identity_state()->>'identity_reviewed_at' is null or api.get_my_verification_case()->>'verified'<>'true' then raise exception 'retention revoked accepted identity presentation';end if;
      perform api.mark_evidence_deleted((a.value->>'artifact_id')::uuid,(a.value->>'claim_token')::uuid) from jsonb_array_elements(proof) a(value);
      if api.get_my_frontend_identity_state()->>'identity_reviewed_at' is null or api.get_my_verification_case()->>'verified'<>'true' then raise exception 'confirmed retention deletion revoked accepted identity presentation';end if;
      insert into restored_owner_identity_probe values('retired_dashboard',api.get_my_dashboard()),('retired_identity',api.get_my_frontend_identity_state());
      update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id='${owner.id}' and revoked_at is null;
      if api.get_my_frontend_identity_state()->>'identity_reviewed_at' is not null or api.get_my_verification_case()->>'verified'<>'false' then raise exception 'revoked identity remained accepted';end if;
    end $fixture$;
    select value from restored_owner_form_probe;
    select 'ALLOWANCE:'||value::text from restored_allowance_probe;
    select 'STAFF_QUEUE:'||value::text from restored_staff_queue_probe;
    select 'EVIDENCE_METADATA:'||value::text from restored_evidence_metadata_probe;
    select 'IDENTITY_CONTEXT:'||value::text from restored_identity_context_probe;
    select 'IDENTITY_QUEUE:'||value::text from restored_identity_queue_probe;
    select 'OWNER_IDENTITY:'||jsonb_build_object('kind',kind,'value',value)::text from restored_owner_identity_probe;
    select 'GOVERNANCE:'||value::text from restored_governance_probe;
    select 'CONTROLS:'||jsonb_build_object('kind',kind,'value',value)::text from restored_controls_probe;
    select 'NATIVE_POST_COMMANDS_PASS';
    rollback;
  `);
  assert.ok(outcome.includes("NATIVE_POST_COMMANDS_PASS"));
  const allowances = outcome
    .split("\n")
    .filter((line) => line.startsWith("ALLOWANCE:"))
    .map((line) => postingAllowanceSchema.parse(JSON.parse(line.slice(10))));
  assert.equal(allowances.length, 2);
  assert.equal(restoredPostingPlanInfo(allowances[0]).freePostAvailable, true);
  assert.equal(restoredPostingPlanInfo(allowances[1]).freePostAvailable, false);
  assert.equal(restoredPostingPlanInfo(allowances[1]).currentCount, 1);
  const queues = outcome
    .split("\n")
    .filter((line) => line.startsWith("STAFF_QUEUE:"))
    .map((line) => parseStaffModerationQueue(JSON.parse(line.slice(12)), reviewer.id));
  assert.equal(queues.length, 2);
  assert.equal(queues[0].allItems[0].description, undefined);
  assert.equal(queues[0].allItems[0].foundation, undefined);
  assert.ok(queues[1].allItems[0].description);
  assert.ok(queues[1].allItems[0].foundation.claimNonce);
  const evidenceMetadata = outcome
    .split("\n")
    .filter((line) => line.startsWith("EVIDENCE_METADATA:"))
    .map((line) => foundationEvidenceMetadataSchema.parse(JSON.parse(line.slice(18))));
  assert.equal(evidenceMetadata.length, 1);
  assert.equal(evidenceMetadata[0].artifacts.length, 2);
  const identityContexts = outcome
    .split("\n")
    .filter((line) => line.startsWith("IDENTITY_CONTEXT:"))
    .map((line) => frontendIdentityContextSchema.parse(JSON.parse(line.slice(17))));
  assert.equal(identityContexts.length, 1);
  assert.equal(identityContexts[0].reviewer_id, reviewer.id);
  assert.ok(identityContexts[0].access_log.length);
  const identityQueues = outcome
    .split("\n")
    .filter((line) => line.startsWith("IDENTITY_QUEUE:"))
    .map((line) => JSON.parse(line.slice(15)));
  assert.equal(identityQueues.length, 2);
  for (const [at, data] of identityQueues.entries()) {
    const view = await readFrontendStaffVerificationQueue(
      { rpc: async () => ({ data, error: null }) },
      reviewer.id
    );
    assert.equal(view.total, 2 - at);
    assert.equal(view.groups[0].steps.length, 2 - at);
    assert.ok(view.groups[0].steps[0].foundation.claimNonce);
  }
  const ownerIdentity = Object.fromEntries(
    outcome
      .split("\n")
      .filter((line) => line.startsWith("OWNER_IDENTITY:"))
      .map((line) => {
        const row = JSON.parse(line.slice(15));
        return [row.kind, row.value];
      })
  );
  const ownerSnapshot = await readFoundationOwnerDashboard(
    {
      rpc: async (name) => ({
        data: name === "get_my_dashboard" ? ownerIdentity.dashboard : ownerIdentity.identity,
        error: null,
      }),
    },
    owner.id
  );
  assert.equal(ownerSnapshot.verification.verified, false);
  assert.equal(
    dashboardVerificationSteps(ownerSnapshot).filter((r) => r.status === "approved").length,
    2
  );
  const retiredSnapshot = await readFoundationOwnerDashboard(
    {
      rpc: async (name) => ({
        data:
          name === "get_my_dashboard"
            ? ownerIdentity.retired_dashboard
            : ownerIdentity.retired_identity,
        error: null,
      }),
    },
    owner.id
  );
  assert.equal(retiredSnapshot.verification.verified, true);
  assert.equal(
    dashboardVerificationSteps(retiredSnapshot).filter((r) => r.status === "approved").length,
    4
  );
  const restored = parseRestoredOwnerPost(
    JSON.parse(outcome.split("\n").find((line) => line.startsWith("{")))
  );
  const controls = Object.fromEntries(
    outcome
      .split("\n")
      .filter((line) => line.startsWith("CONTROLS:"))
      .map((line) => {
        const row = JSON.parse(line.slice(9));
        return [row.kind, row.value];
      })
  );
  const flags = await readFrontendFeatureFlags(
    { rpc: async () => ({ data: controls.flags, error: null }) },
    administrator.id
  );
  assert.equal(flags[0].mode, "allowlist");
  assert.deepEqual(flags[0].allowlist_roles, ["admin", "moderator"]);
  const display = await readFrontendFeatureConfig({
    rpc: async () => ({ data: controls.config, error: null }),
  });
  assert.equal(display[0].enabled, false);
  const metrics = await readFrontendGovernanceMetrics(
    { rpc: async () => ({ data: controls.metrics, error: null }) },
    governor.id
  );
  assert.equal(metrics.approved, 1);
  assert.equal(metrics.rejected, 1);
  assert.equal(metrics.overridden, 1);
  assert.equal(metrics.total, 3);
  const governanceProbes = outcome
    .split("\n")
    .filter((line) => line.startsWith("GOVERNANCE:"))
    .map((line) => JSON.parse(line.slice(11)));
  assert.equal(governanceProbes.length, 4);
  for (const [index, probe] of governanceProbes.entries()) {
    const rows = await readRestoredGovernance(
      { rpc: async () => ({ data: probe, error: null }) },
      governor.id,
      { status: "all" }
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, ["escalated", "approved", "rejected", "withdrawn"][index]);
    assert.equal(rows[0].approval_rationale, index === 1 ? "Synthetic independent approval" : null);
    assert.equal(rows[0].timeline.length, index === 1 ? 3 : 2);
  }
  assert.equal(
    restoredOwnerPostRow(restored, owner.id).location_address,
    "Updated fixture address"
  );
  assert.equal(sql("select to_regclass('private.frontend_post_commands') is null;"), "t");
  report.checks.push(
    "listing/business/event form commands",
    "self-only native posting gate, trial claim and current capacity DTOs",
    "staff moderation summaries, claim-scoped bodies and represented lease DTOs",
    "actual native evidence metadata contract used by private authorization",
    "separate ID/selfie approvals bind one live lease; only both attestations invoke native identity acceptance; final acknowledgement is retry-safe",
    "accepted ID remains a completed step before location; rejected retake receipts do not resurrect; high-risk approval still requires another real staff actor",
    "retention retires accepted evidence without losing owner verification; explicitly revoked identity remains unverified",
    "preserved governance queue/detail DTOs, represented independent approval, rejection without restriction, authored withdrawal and exact audit-bound acknowledgement retries",
    "typed mixed claim metadata, foreign lease secrecy, atomic renew/release and audited independent evidence handoff",
    "create/submit/trial once",
    "owned ready logo and poster retained",
    "native independent moderation",
    "live edit isolation and presentation merge",
    "presentation edit consumes edit budget",
    "non-live save waits for explicit resubmission",
    "non-live approval cannot bypass approved edit allowance",
    "price-only approval retains separate daily limit",
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
  report.contexts = [...String(error.stderr ?? "").matchAll(/PL\/pgSQL function [^\r\n]+/g)]
    .map((m) => m[0].slice(0, 200))
    .slice(0, 8);
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

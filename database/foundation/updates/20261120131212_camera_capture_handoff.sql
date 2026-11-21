-- ID photos are taken with the camera only, and a member on a computer
-- without a usable camera can continue on their phone (Didit plan, build step 2).
--
-- From this update:
-- 1. New table private.capture_handoffs: one row per "Continue on your phone"
--    link. The link's random 32-byte token is made by the website and only its
--    SHA-256 is stored (token_sha256). A row is bound to one account, its open
--    identity case and the computer's live session (session_id), and is valid
--    for 15 minutes after it was made (expires_at, fixed by a check). It is
--    used once: opening it on the phone stores used_at and the SHA-256 of a
--    second random secret the website gives that phone (grant_sha256, the
--    "capture grant"). The row also holds the encrypted ID number receipt the
--    computer sent (fingerprint, encrypted_number: the same values the upload
--    commands store), so the phone never sees or types the ID number. Only the
--    newest link of an account works: making a new one retires the earlier
--    ones. No API role has table access.
-- 2. api.start_capture_handoff(token_sha256, first_name, last_name, with_id)
--    (authenticated, live session): saves the typed legal names as the ID
--    upload does, opens the identity case, and stores the link. At most 5
--    links an hour per account (PT429, detail handoff_rate_limited). A member
--    never supplies an ID number receipt: with with_id the link waits for one
--    and works only once api.attach_capture_handoff_identity(owner, token,
--    identity) (service only) has attached the receipt the website's server
--    made from the typed ID number. Without names and ID details the phone may
--    only take the selfie, so an ID photo of the open case must already be
--    uploaded (PT409, detail handoff_needs_id).
-- 3. api.redeem_capture_handoff(token_sha256, grant_sha256, signed_in)
--    (service only, called by the website when the phone opens the link):
--    single use. The phone must be signed in as the account that made the
--    link (owner decision): the website passes the phone's GoTrue-verified
--    account. No account: 42501, detail handoff_sign_in_required; another
--    account: 42501, detail handoff_other_account; both without using up the
--    link. Otherwise refused (PT409, detail handoff_unavailable) when the link
--    is unknown, used, expired, replaced, its computer session has ended, the
--    account has lost access or the case was closed, accepted or sent for
--    independent review.
-- 4. api.capture_handoff_context(grant_sha256, signed_in) (service only): what
--    the phone may still do (the account's short public name, whether the ID
--    photo and the selfie are still needed, the expiry), only for the signed-in
--    owner. Nothing else is read.
-- 5. api.reserve_handoff_verification_upload(grant_sha256, signed_in, request,
--    purpose, digest, browser_liveness_passed) (service only, signed-in owner
--    only): reserves an ID photo or selfie upload for the link's case only,
--    exactly as api.reserve_frontend_verification_upload does for a signed-in
--    member, on the computer's session (so signing out on the computer stops
--    the phone). Refused once the link has both photos (PT409, detail
--    handoff_done). The phone's selfie is stored as taken with the camera
--    (browser-reported review context, not a proof: a modified browser or a
--    virtual camera can send any image; staff still review every case). The
--    website then completes the upload with the existing service commands
--    (frontend_verification_upload_context, complete_frontend_verification_upload).
-- 6. Retention: internal.purge_capture_handoffs deletes links one day after
--    they expired (with the ID number receipt they hold); internal.run_retention
--    (same signature) runs it as 'capture_handoffs'.
--
-- New commands only (expand); no existing command changes. A website release
-- without the matching code never calls them. The website refuses selfies the
-- browser says were uploaded files; the same refusal in
-- internal.record_my_selfie_capture comes in a later contract update, after
-- this website release is deployed (here it would break the live page between
-- applying and deploying). ORDER: apply first, then merge.
-- Read-only preflight: ../preflight/20261120131212_camera_capture_handoff.check.sql.
-- Rollback: ../rollback/20261120131212_camera_capture_handoff.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and the
-- functions it replaces have their reviewed bodies (or this update's).
do $$
declare present integer;
begin
  select (to_regclass('private.capture_handoffs') is not null)::integer
    + (to_regprocedure('internal.purge_capture_handoffs(integer)') is not null)::integer
    + (to_regprocedure('api.start_capture_handoff(text,text,text,boolean)') is not null)::integer
    + (to_regprocedure('api.attach_capture_handoff_identity(uuid,text,jsonb)') is not null)::integer
    + (to_regprocedure('api.redeem_capture_handoff(text,text,uuid)') is not null)::integer
    + (to_regprocedure('api.capture_handoff_context(text,uuid)') is not null)::integer
    + (to_regprocedure('api.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean)') is not null)::integer
  into present;
  if present not in (0, 7) then
    raise exception 'camera capture handoff precondition: % of 7 objects exist', present using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.run_retention(integer)'))
      not in ('95dda89b3f540a74110a0ca1eba02e66', '1d51acbc8fb435ac6f9b1f12a9020c2b') then
    raise exception 'camera capture handoff drift: internal.run_retention is not the reviewed body' using errcode='55000';
  end if;
end$$;

-- 1. The links.
create table if not exists private.capture_handoffs (
  token_sha256 text not null,
  owner_id uuid not null,
  case_id uuid not null,
  session_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  grant_sha256 text,
  fingerprint text,
  encrypted_number jsonb,
  expects_id boolean not null default false,
  constraint capture_handoffs_pkey primary key (token_sha256),
  constraint capture_handoffs_grant_key unique (grant_sha256),
  constraint capture_handoffs_token_check check (token_sha256 ~ '^[a-f0-9]{64}$'),
  constraint capture_handoffs_grant_check check (grant_sha256 ~ '^[a-f0-9]{64}$' and grant_sha256 <> token_sha256),
  constraint capture_handoffs_expiry_check check (expires_at = created_at + interval '15 minutes'),
  constraint capture_handoffs_used_check check (grant_sha256 is null or used_at is not null),
  constraint capture_handoffs_identity_check check ((fingerprint is null) = (encrypted_number is null)),
  constraint capture_handoffs_expects_id_check check (fingerprint is null or expects_id),
  constraint capture_handoffs_fingerprint_check check (fingerprint ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  constraint capture_handoffs_encrypted_number_check check (encrypted_number is null
    or (jsonb_typeof(encrypted_number) = 'object'
      and encrypted_number - array['ciphertext','iv','tag','key_id'] = '{}'::jsonb
      and encrypted_number ?& array['ciphertext','iv','tag','key_id']
      and encrypted_number->>'ciphertext' ~ '^[a-f0-9]{26}$'
      and encrypted_number->>'iv' ~ '^[a-f0-9]{24}$'
      and encrypted_number->>'tag' ~ '^[a-f0-9]{32}$'
      and encrypted_number->>'key_id' = 'identity-number-v1')),
  constraint capture_handoffs_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete cascade,
  constraint capture_handoffs_case_id_owner_id_fkey foreign key (case_id, owner_id)
    references private.evidence_cases(id, subject_id) on delete cascade
);
alter table private.capture_handoffs owner to postgres;
alter table private.capture_handoffs enable row level security;
revoke all on private.capture_handoffs from public, anon, authenticated, service_role;
create index if not exists capture_handoffs_owner_idx
  on private.capture_handoffs using btree (owner_id, created_at desc);
create index if not exists capture_handoffs_case_idx
  on private.capture_handoffs using btree (case_id, owner_id);
create index if not exists capture_handoffs_expires_idx
  on private.capture_handoffs using btree (expires_at);
comment on table private.capture_handoffs is 'Continue on your phone links: SHA-256 of a single-use token, bound to one account, its open identity case and the computer''s live session, valid 15 minutes; the phone''s capture grant is stored as a SHA-256 only. Deleted one day after expiry.';

-- The newest completed, clean ID photo upload of an open case (the one a
-- selfie is paired with), as api.reserve_frontend_verification_upload finds it.
CREATE OR REPLACE FUNCTION internal.capture_handoff_prior_id(p_owner uuid, p_case uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select r.request_id from private.frontend_verification_uploads r
    join private.evidence_artifacts a on a.id=r.artifact_id and a.owner_id=r.owner_id and a.case_id=r.case_id
    where r.owner_id=p_owner and r.case_id=p_case and r.purpose='id_front'
      and r.completed_at is not null and r.expires_at>clock_timestamp() and r.fingerprint is not null
      and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp())
    order by r.created_at desc,r.request_id limit 1;
$function$;
alter function internal.capture_handoff_prior_id(uuid,uuid) owner to postgres;
revoke all on function internal.capture_handoff_prior_id(uuid,uuid) from public, anon, authenticated, service_role;

-- What the phone may still do for a link (no identifiers beyond the owner,
-- which only the website's server sees).
CREATE OR REPLACE FUNCTION internal.capture_handoff_state(p_handoff private.capture_handoffs)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'owner_id',p_handoff.owner_id,
    'expires_at',p_handoff.expires_at,
    'public_name',coalesce(internal.profile_public_name(
      (select p.display_name from private.profiles p where p.account_id=p_handoff.owner_id)),'Member'),
    'needs_id',p_handoff.fingerprint is not null and not exists(
      select 1 from private.frontend_verification_uploads r where r.owner_id=p_handoff.owner_id
        and r.case_id=p_handoff.case_id and r.purpose='id_front' and r.completed_at is not null
        and r.created_at>=p_handoff.created_at),
    'needs_selfie',not exists(
      select 1 from private.frontend_verification_uploads r where r.owner_id=p_handoff.owner_id
        and r.case_id=p_handoff.case_id and r.purpose='selfie' and r.completed_at is not null
        and r.created_at>=p_handoff.created_at));
$function$;
alter function internal.capture_handoff_state(private.capture_handoffs) owner to postgres;
revoke all on function internal.capture_handoff_state(private.capture_handoffs) from public, anon, authenticated, service_role;

-- A link that still works: not expired, the newest of its account, its
-- computer session live, the account current and the case still open for
-- new photos. p_used says whether it must already be opened on the phone.
-- Callers lock the owner's verification subject first.
CREATE OR REPLACE FUNCTION internal.capture_handoff_usable(p_handoff private.capture_handoffs, p_used boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_handoff.token_sha256 is not null
    and (p_handoff.used_at is not null)=p_used
    and (not p_handoff.expects_id or p_handoff.fingerprint is not null)
    and p_handoff.expires_at>clock_timestamp()
    and not exists(select 1 from private.capture_handoffs n where n.owner_id=p_handoff.owner_id
      and n.created_at>p_handoff.created_at)
    and exists(select 1 from auth.sessions s where s.id=p_handoff.session_id and s.user_id=p_handoff.owner_id
      and (s.not_after is null or s.not_after>clock_timestamp()))
    and exists(select 1 from private.current_account_access a where a.id=p_handoff.owner_id)
    and not exists(select 1 from private.account_closures x where x.user_id=p_handoff.owner_id)
    and exists(select 1 from private.evidence_cases c where c.id=p_handoff.case_id
      and c.subject_id=p_handoff.owner_id and c.kind='kyc' and c.status='open')
    and not exists(select 1 from private.accepted_identity_facts f where f.owner_id=p_handoff.owner_id)
    and not exists(select 1 from private.decisions d where d.case_id=p_handoff.case_id and d.status='proposed'
      and d.action='approve_override' and d.payload ? 'identity_submission_id');
$function$;
alter function internal.capture_handoff_usable(private.capture_handoffs, boolean) owner to postgres;
revoke all on function internal.capture_handoff_usable(private.capture_handoffs, boolean) from public, anon, authenticated, service_role;

-- The phone must be signed in as the link's owner (owner decision).
CREATE OR REPLACE FUNCTION internal.capture_handoff_signed_in(p_handoff private.capture_handoffs, p_signed_in uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_signed_in is null then
    raise exception 'sign in on this phone with the same account' using errcode='42501',detail='handoff_sign_in_required'; end if;
  if p_signed_in<>p_handoff.owner_id then
    raise exception 'signed in as another account' using errcode='42501',detail='handoff_other_account'; end if;
end;
$function$;
alter function internal.capture_handoff_signed_in(private.capture_handoffs, uuid) owner to postgres;
revoke all on function internal.capture_handoff_signed_in(private.capture_handoffs, uuid) from public, anon, authenticated, service_role;

-- The link behind a phone's capture grant, locked, for its signed-in owner;
-- else PT409 handoff_unavailable (or 42501 for the wrong or no account).
CREATE OR REPLACE FUNCTION internal.capture_handoff_by_grant(p_grant_sha256 text, p_signed_in uuid)
 RETURNS private.capture_handoffs
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare h private.capture_handoffs; owner uuid;
begin
  if p_grant_sha256 is null or p_grant_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'capture grant required' using errcode='22023'; end if;
  if p_signed_in is null then
    raise exception 'sign in on this phone with the same account' using errcode='42501',detail='handoff_sign_in_required'; end if;
  select x.owner_id into owner from private.capture_handoffs x where x.grant_sha256=p_grant_sha256;
  if owner is not null then
    perform internal.lock_verification_subject(owner);
    select x.* into h from private.capture_handoffs x where x.grant_sha256=p_grant_sha256 for update;
  end if;
  if h.token_sha256 is null or not internal.capture_handoff_usable(h,true) then
    raise exception 'phone link expired or replaced' using errcode='PT409',detail='handoff_unavailable'; end if;
  perform internal.capture_handoff_signed_in(h,p_signed_in);
  return h;
end;
$function$;
alter function internal.capture_handoff_by_grant(text, uuid) owner to postgres;
revoke all on function internal.capture_handoff_by_grant(text, uuid) from public, anon, authenticated, service_role;

-- 2. The computer makes a link. A member never hands the database an ID
-- number receipt: with p_with_id the link waits for one, which only the
-- website's server attaches (step 2b) after checking the typed ID number.
CREATE OR REPLACE FUNCTION internal.start_capture_handoff(p_token_sha256 text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_with_id boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); opened jsonb; profile private.profiles;
  made timestamptz; h private.capture_handoffs;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'phone link token required' using errcode='22023'; end if;
  if p_with_id is null or (p_first_name is null)<>(p_last_name is null) or (p_first_name is not null)<>p_with_id then
    raise exception 'names and ID details come together' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  if (select count(*) from private.capture_handoffs x where x.owner_id=actor
      and x.created_at>clock_timestamp()-interval '1 hour')>=5 then
    raise exception 'too many phone links' using errcode='PT429',detail='handoff_rate_limited'; end if;
  if exists(select 1 from private.capture_handoffs x where x.token_sha256=p_token_sha256) then
    raise exception 'phone link token already used' using errcode='PT409'; end if;
  if p_first_name is not null then
    select * into profile from private.profiles where account_id=actor for update;
    if (profile.legal_first_name,profile.legal_last_name) is distinct from (p_first_name,p_last_name) then
      perform internal.save_my_legal_name(profile.revision,p_first_name,p_last_name);
    end if;
  end if;
  opened:=internal.open_verification_case();
  if (opened->>'read_only')::boolean then
    raise exception 'identity is accepted or under independent review' using errcode='PT409'; end if;
  if not p_with_id and internal.capture_handoff_prior_id(actor,(opened->>'case_id')::uuid) is null then
    raise exception 'ID details required' using errcode='PT409',detail='handoff_needs_id'; end if;
  made:=clock_timestamp();
  insert into private.capture_handoffs(token_sha256,owner_id,case_id,session_id,created_at,expires_at,expects_id)
    values(p_token_sha256,actor,(opened->>'case_id')::uuid,(auth.jwt()->>'session_id')::uuid,made,
      made+interval '15 minutes',p_with_id)
    returning * into h;
  perform internal.price_draft_actor();
  return jsonb_build_object('expires_at',h.expires_at,'needs_id',h.expects_id);
end;
$function$;
alter function internal.start_capture_handoff(text,text,text,boolean) owner to postgres;
revoke all on function internal.start_capture_handoff(text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.start_capture_handoff(text,text,text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.start_capture_handoff(p_token_sha256 text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_with_id boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_capture_handoff(p_token_sha256,p_first_name,p_last_name,p_with_id);
$function$;
alter function api.start_capture_handoff(text,text,text,boolean) owner to postgres;
revoke all on function api.start_capture_handoff(text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function api.start_capture_handoff(text,text,text,boolean) to authenticated;

-- 2b. The website's server attaches the encrypted ID number receipt it made
-- from the typed ID number (checksum and 18+ checked) to the new link. Only
-- an unopened, unexpired link of that owner that waits for one.
CREATE OR REPLACE FUNCTION internal.attach_capture_handoff_identity(p_owner uuid, p_token_sha256 text, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_owner is null or p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'phone link required' using errcode='22023'; end if;
  if p_identity is null or jsonb_typeof(p_identity)<>'object'
      or p_identity-array['fingerprint','encrypted_number']<>'{}'::jsonb
      or not(p_identity ?& array['fingerprint','encrypted_number'])
      or jsonb_typeof(p_identity->'fingerprint') is distinct from 'string'
      or p_identity->>'fingerprint' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      or jsonb_typeof(p_identity->'encrypted_number') is distinct from 'object'
      or (p_identity->'encrypted_number')-array['ciphertext','iv','tag','key_id']<>'{}'::jsonb
      or not(p_identity->'encrypted_number' ?& array['ciphertext','iv','tag','key_id'])
      or jsonb_typeof(p_identity->'encrypted_number'->'ciphertext') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'iv') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'tag') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'key_id') is distinct from 'string'
      or p_identity->'encrypted_number'->>'ciphertext' !~ '^[a-f0-9]{26}$'
      or p_identity->'encrypted_number'->>'iv' !~ '^[a-f0-9]{24}$'
      or p_identity->'encrypted_number'->>'tag' !~ '^[a-f0-9]{32}$'
      or p_identity->'encrypted_number'->>'key_id' is distinct from 'identity-number-v1' then
    raise exception 'encrypted identity receipt required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  update private.capture_handoffs h set fingerprint=p_identity->>'fingerprint',
      encrypted_number=p_identity->'encrypted_number'
    where h.token_sha256=p_token_sha256 and h.owner_id=p_owner and h.expects_id
      and h.fingerprint is null and h.used_at is null and h.expires_at>clock_timestamp();
  if not found then
    raise exception 'phone link expired or already used' using errcode='PT409',detail='handoff_unavailable'; end if;
  return jsonb_build_object('attached',true);
end;
$function$;
alter function internal.attach_capture_handoff_identity(uuid,text,jsonb) owner to postgres;
revoke all on function internal.attach_capture_handoff_identity(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.attach_capture_handoff_identity(uuid,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION api.attach_capture_handoff_identity(p_owner uuid, p_token_sha256 text, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.attach_capture_handoff_identity(p_owner,p_token_sha256,p_identity);
$function$;
alter function api.attach_capture_handoff_identity(uuid,text,jsonb) owner to postgres;
revoke all on function api.attach_capture_handoff_identity(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function api.attach_capture_handoff_identity(uuid,text,jsonb) to service_role;

-- 3. The phone opens the link (once).
CREATE OR REPLACE FUNCTION internal.redeem_capture_handoff(p_token_sha256 text, p_grant_sha256 text, p_signed_in uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare h private.capture_handoffs; owner uuid;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$'
    or p_grant_sha256 is null or p_grant_sha256 !~ '^[a-f0-9]{64}$' or p_grant_sha256=p_token_sha256 then
    raise exception 'phone link token and capture grant required' using errcode='22023'; end if;
  -- Asked before the link is looked up: a signed-out phone learns nothing.
  if p_signed_in is null then
    raise exception 'sign in on this phone with the same account' using errcode='42501',detail='handoff_sign_in_required'; end if;
  select x.owner_id into owner from private.capture_handoffs x where x.token_sha256=p_token_sha256;
  if owner is not null then
    perform internal.lock_verification_subject(owner);
    select x.* into h from private.capture_handoffs x where x.token_sha256=p_token_sha256 for update;
  end if;
  if h.token_sha256 is null or not internal.capture_handoff_usable(h,false) then
    raise exception 'phone link expired or already used' using errcode='PT409',detail='handoff_unavailable'; end if;
  perform internal.capture_handoff_signed_in(h,p_signed_in);
  update private.capture_handoffs set used_at=clock_timestamp(),grant_sha256=p_grant_sha256
    where token_sha256=p_token_sha256 returning * into h;
  return internal.capture_handoff_state(h);
end;
$function$;
alter function internal.redeem_capture_handoff(text,text,uuid) owner to postgres;
revoke all on function internal.redeem_capture_handoff(text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.redeem_capture_handoff(text,text,uuid) to service_role;

CREATE OR REPLACE FUNCTION api.redeem_capture_handoff(p_token_sha256 text, p_grant_sha256 text, p_signed_in uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.redeem_capture_handoff(p_token_sha256,p_grant_sha256,p_signed_in);
$function$;
alter function api.redeem_capture_handoff(text,text,uuid) owner to postgres;
revoke all on function api.redeem_capture_handoff(text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function api.redeem_capture_handoff(text,text,uuid) to service_role;

-- 4. What the phone may still do.
CREATE OR REPLACE FUNCTION internal.capture_handoff_context(p_grant_sha256 text, p_signed_in uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  return internal.capture_handoff_state(internal.capture_handoff_by_grant(p_grant_sha256,p_signed_in));
end;
$function$;
alter function internal.capture_handoff_context(text, uuid) owner to postgres;
revoke all on function internal.capture_handoff_context(text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.capture_handoff_context(text, uuid) to service_role;

CREATE OR REPLACE FUNCTION api.capture_handoff_context(p_grant_sha256 text, p_signed_in uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.capture_handoff_context(p_grant_sha256,p_signed_in);
$function$;
alter function api.capture_handoff_context(text, uuid) owner to postgres;
revoke all on function api.capture_handoff_context(text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.capture_handoff_context(text, uuid) to service_role;

-- 5. The phone reserves an upload for the link's case.
CREATE OR REPLACE FUNCTION internal.reserve_handoff_verification_upload(p_grant_sha256 text, p_signed_in uuid, p_request uuid, p_purpose text, p_digest text, p_browser_liveness_passed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare h private.capture_handoffs; old private.frontend_verification_uploads; prior uuid;
  version integer; artifact uuid;
begin
  if p_request is null or p_purpose is null or p_purpose not in('id_front','selfie')
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or (p_purpose='selfie')<>(p_browser_liveness_passed is not null) then
    raise exception 'upload request required' using errcode='22023'; end if;
  h:=internal.capture_handoff_by_grant(p_grant_sha256,p_signed_in);
  select * into old from private.frontend_verification_uploads where owner_id=h.owner_id and request_id=p_request;
  if found then
    if old.request_digest<>p_digest or old.purpose<>p_purpose or old.case_id<>h.case_id
      or old.expires_at<=clock_timestamp() then
      raise exception 'upload request changed or expired' using errcode='PT409'; end if;
    if exists(select 1 from private.verification_return_requests v where v.case_id=old.case_id and v.case_version>=old.case_version) then
      raise exception 'upload belongs to a returned submission; reload verification' using errcode='PT409'; end if;
    return jsonb_build_object('artifact_id',old.artifact_id,'completed',old.completed_at is not null,
      'identity',case when old.purpose='id_front' and old.completed_at is null then
        jsonb_build_object('fingerprint',h.fingerprint,'encrypted_number',h.encrypted_number) end);
  end if;
  -- Both photos of this link are in: nothing more is taken through it.
  if not (internal.capture_handoff_state(h)->>'needs_id')::boolean
    and not (internal.capture_handoff_state(h)->>'needs_selfie')::boolean then
    raise exception 'this phone link has both photos' using errcode='PT409',detail='handoff_done'; end if;
  if p_purpose='id_front' and h.fingerprint is null then
    raise exception 'ID details required' using errcode='PT409',detail='handoff_needs_id'; end if;
  perform c.id from private.evidence_cases c where c.id=h.case_id and c.subject_id=h.owner_id
    and c.kind='kyc' and c.status='open' for update;
  if p_purpose='selfie' then
    prior:=internal.capture_handoff_prior_id(h.owner_id,h.case_id);
    if prior is null then raise exception 'upload the ID document first' using errcode='PT409'; end if;
  end if;
  if (select count(*) from private.evidence_artifacts a where a.case_id=h.case_id and a.state='intent')>=5 then
    raise exception 'too many unfinished uploads' using errcode='PT429'; end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(h.case_id,h.owner_id,p_purpose,'evidence/'||h.case_id||'/'||pg_catalog.gen_random_uuid())
    returning id into artifact;
  select c.version into version from private.evidence_cases c where c.id=h.case_id;
  insert into private.frontend_verification_uploads(owner_id,request_id,session_id,case_id,case_version,purpose,
      request_digest,artifact_id,id_request,capture_method,browser_liveness_passed)
    values(h.owner_id,p_request,h.session_id,h.case_id,version,p_purpose,p_digest,artifact,prior,
      case when p_purpose='selfie' then 'camera' end,p_browser_liveness_passed);
  return jsonb_build_object('artifact_id',artifact,'completed',false,
    'identity',case when p_purpose='id_front' then
      jsonb_build_object('fingerprint',h.fingerprint,'encrypted_number',h.encrypted_number) end);
end;
$function$;
alter function internal.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean) owner to postgres;
revoke all on function internal.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean) to service_role;

CREATE OR REPLACE FUNCTION api.reserve_handoff_verification_upload(p_grant_sha256 text, p_signed_in uuid, p_request uuid, p_purpose text, p_digest text, p_browser_liveness_passed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reserve_handoff_verification_upload(p_grant_sha256,p_signed_in,p_request,p_purpose,p_digest,p_browser_liveness_passed);
$function$;
alter function api.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean) owner to postgres;
revoke all on function api.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function api.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean) to service_role;

-- 6. Retention.
CREATE OR REPLACE FUNCTION internal.purge_capture_handoffs(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  delete from private.capture_handoffs h where h.token_sha256 in (
    select x.token_sha256 from private.capture_handoffs x
    where x.expires_at < clock_timestamp() - interval '1 day'
    order by x.expires_at limit p_limit);
  get diagnostics n = row_count;
  return n;
end;
$function$;
alter function internal.purge_capture_handoffs(integer) owner to postgres;
revoke all on function internal.purge_capture_handoffs(integer) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit),
    'engagement',internal.purge_post_engagement(),
    'member_invitations',internal.purge_member_invitations(p_limit),
    'capture_handoffs',internal.purge_capture_handoffs(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

notify pgrst,'reload schema';
commit;

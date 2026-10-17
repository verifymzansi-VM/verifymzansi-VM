-- Trusted verification facts. Local candidate, never a hosted migration.
-- Processing assertions are not accepted identities. Only independent reviewed
-- ID-number/document/selfie attestations establish an accepted fingerprint.
create table private.verification_phone_challenges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  phone text not null check(phone ~ '^\+27[0-9]{9}$'),
  otp_hash text not null check(length(otp_hash) between 16 and 512),
  attempts integer not null default 0 check(attempts between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
  verified_at timestamptz,
  check(expires_at>created_at), unique(id,owner_id)
);
create index verification_phone_challenges_owner_idx on private.verification_phone_challenges(owner_id,id);
create table private.verification_phone_proofs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  challenge_id uuid not null unique,
  phone text not null check(phone ~ '^\+27[0-9]{9}$'),
  verified_at timestamptz not null default clock_timestamp(),
  contact_changed_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key(challenge_id,owner_id) references private.verification_phone_challenges(id,owner_id)
);
create unique index verification_phone_owner_active_idx on private.verification_phone_proofs(owner_id) where revoked_at is null;
create unique index verification_phone_unique_active_idx on private.verification_phone_proofs(phone) where revoked_at is null;
create table private.verification_localities (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  province_id text not null,
  city_id text not null,
  assurance text not null default 'self_declared' check(assurance='self_declared'),
  confirmed_at timestamptz not null default clock_timestamp(),
  foreign key(city_id,province_id) references private.cities(id,province_id)
);
create table private.verification_identity_submissions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null,
  owner_id uuid not null,
  case_version integer not null check(case_version>0),
  id_artifact_id uuid not null references private.evidence_artifacts(id),
  selfie_artifact_id uuid not null references private.evidence_artifacts(id),
  identity_hmac text not null check(identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  identity_key_id text not null check(identity_key_id='identity-match-v1'),
  protocol text not null default 'sa-id-hmac-sha256-v1' check(protocol='sa-id-hmac-sha256-v1'),
  -- Source-compatible AES256-GCM:13 ASCII digits,96-bit nonce,128-bit tag.
  -- Worker must use AAD owner_id||':id_doc'; DB never receives the encryption key.
  number_ciphertext text not null check(number_ciphertext ~ '^[a-f0-9]{26}$'),
  number_iv text not null check(number_iv ~ '^[a-f0-9]{24}$'),
  number_tag text not null check(number_tag ~ '^[a-f0-9]{32}$'),
  encryption_key_id text not null check(encryption_key_id='identity-number-v1'),
  receipt_id uuid not null unique,
  recipe text not null check(recipe='manual-id-selfie-v1'),
  risk_score integer not null check(risk_score between 0 and 100),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(case_id,owner_id) references private.evidence_cases(id,subject_id),
  unique(id,owner_id), check(id_artifact_id<>selfie_artifact_id)
);
create index verification_submissions_case_idx on private.verification_identity_submissions(case_id,id);
create index verification_submissions_owner_idx on private.verification_identity_submissions(owner_id,id);
create table private.verification_current_submissions (
  case_id uuid primary key references private.evidence_cases(id),
  submission_id uuid not null unique references private.verification_identity_submissions(id)
);
create table private.accepted_identity_facts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  submission_id uuid not null unique,
  identity_hmac text not null check(identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  reviewed_by uuid not null references auth.users(id),
  second_reviewer uuid references auth.users(id),
  decision_id uuid unique references private.decisions(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key(submission_id,owner_id) references private.verification_identity_submissions(id,owner_id),
  check(owner_id<>reviewed_by and owner_id is distinct from second_reviewer),
  check((second_reviewer is null)=(decision_id is null)),
  check(second_reviewer is distinct from reviewed_by)
);
create unique index accepted_identity_owner_active_idx on private.accepted_identity_facts(owner_id) where revoked_at is null;
create unique index accepted_identity_fingerprint_active_idx on private.accepted_identity_facts(identity_hmac) where revoked_at is null;
create table private.identity_review_proposals (
  decision_id uuid primary key references private.decisions(id),
  submission_id uuid not null references private.verification_identity_submissions(id),
  reviewer_session uuid not null,
  reviewed_at timestamptz not null default clock_timestamp()
);
-- This copy has the ban's explicit5-year deadline. Generic immutable decisions
-- store only an opaque fact ID/category, never another permanent fingerprint.
create table private.identity_ban_bindings (
  decision_id uuid primary key references private.decisions(id),
  fact_id uuid not null,
  identity_hmac text not null check(identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  category text not null check(category in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other')),
  approved_at timestamptz not null,
  retain_until timestamptz not null,
  check(retain_until=approved_at+interval '5 years')
);
create index identity_ban_bindings_expiry_idx on private.identity_ban_bindings(retain_until);
create table private.identity_ban_proposal_requests (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  fact_id uuid not null,
  category text not null check(category in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other')),
  decision_id uuid not null unique references private.decisions(id)
);
alter table private.identity_ban_proposal_requests enable row level security;
revoke all on private.identity_ban_proposal_requests from public,anon,authenticated,service_role;

alter table private.verification_phone_challenges enable row level security;
alter table private.verification_phone_proofs enable row level security;
alter table private.verification_localities enable row level security;
alter table private.verification_identity_submissions enable row level security;
alter table private.verification_current_submissions enable row level security;
alter table private.accepted_identity_facts enable row level security;
alter table private.identity_review_proposals enable row level security;
alter table private.identity_ban_bindings enable row level security;
revoke all on private.verification_phone_challenges,private.verification_phone_proofs,
  private.verification_localities,private.verification_identity_submissions,
  private.verification_current_submissions,private.accepted_identity_facts,
  private.identity_review_proposals,private.identity_ban_bindings from public,anon,authenticated,service_role;

create function internal.lock_verification_subject(p_owner uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform internal.lock_evidence_subject(p_owner);
  perform c.id from private.evidence_cases c where c.subject_id=p_owner order by c.id for update;
end;
$$;
revoke all on function internal.lock_verification_subject(uuid) from public,anon,authenticated,service_role;

create function internal.verification_submission_immutable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'verification submission is immutable; replace with a new receipt' using errcode='23514';
end;
$$;
revoke all on function internal.verification_submission_immutable() from public,anon,authenticated,service_role;
create trigger verification_submission_immutable before update on private.verification_identity_submissions
  for each row execute function internal.verification_submission_immutable();

create function internal.verification_artifacts_ready(p_submission uuid)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select exists(select 1 from private.verification_identity_submissions s
    join private.evidence_artifacts i on i.id=s.id_artifact_id and i.owner_id=s.owner_id and i.case_id=s.case_id
    join private.evidence_artifacts f on f.id=s.selfie_artifact_id and f.owner_id=s.owner_id and f.case_id=s.case_id
    where s.id=p_submission and i.purpose='id_front' and f.purpose='selfie'
      and i.state='clean' and f.state='clean'
      and (i.retain_until is null or i.retain_until>clock_timestamp())
      and (f.retain_until is null or f.retain_until>clock_timestamp()));
$$;
revoke all on function internal.verification_artifacts_ready(uuid) from public,anon,authenticated,service_role;

create function internal.open_verification_case()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); c private.evidence_cases;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  select e.* into c from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases e on e.id=s.case_id where f.owner_id=actor order by f.reviewed_at desc,f.id desc limit 1;
  if found then return jsonb_build_object('case_id',c.id,'version',c.version,'status','accepted','read_only',true); end if;
  select e.* into c from private.evidence_cases e where e.subject_id=actor and e.kind='kyc' and e.status='open' order by e.created_at desc,e.id limit 1;
  if not found then insert into private.evidence_cases(subject_id,kind) values(actor,'kyc') returning * into c; end if;
  return jsonb_build_object('case_id',c.id,'version',c.version,'status','open','read_only',exists(
    select 1 from private.decisions d where d.case_id=c.id and d.status='proposed' and d.action='approve_override' and d.payload ? 'identity_submission_id'));
end;
$$;
revoke all on function internal.open_verification_case() from public,anon,authenticated,service_role;
grant execute on function internal.open_verification_case() to authenticated;
create function api.open_verification_case()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.open_verification_case();
$$;
revoke all on function api.open_verification_case() from public,anon,authenticated,service_role;
grant execute on function api.open_verification_case() to authenticated;

create function internal.confirm_verification_locality(p_province text,p_city text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); prior private.verification_localities;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  if not exists(select 1 from private.cities c where c.id=p_city and c.province_id=p_province) then
    raise exception 'canonical city/province pair required' using errcode='22023'; end if;
  select l.* into prior from private.verification_localities l where l.owner_id=actor;
  if found then
    if (prior.province_id,prior.city_id) is distinct from (p_province,p_city) then
      raise exception 'approved locality requires authorised resubmission' using errcode='PT409'; end if;
    return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city,'reused',true);
  end if;
  insert into private.verification_localities(owner_id,province_id,city_id) values(actor,p_province,p_city)
  on conflict(owner_id) do update set province_id=excluded.province_id,city_id=excluded.city_id,confirmed_at=clock_timestamp();
  return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city);
end;
$$;
revoke all on function internal.confirm_verification_locality(text,text) from public,anon,authenticated,service_role;
grant execute on function internal.confirm_verification_locality(text,text) to authenticated;
create function api.confirm_verification_locality(p_province text,p_city text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.confirm_verification_locality(p_province,p_city);
$$;
revoke all on function api.confirm_verification_locality(text,text) from public,anon,authenticated,service_role;
grant execute on function api.confirm_verification_locality(text,text) to authenticated;

create function internal.create_verification_phone_challenge(p_owner uuid,p_phone text,p_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare challenge private.verification_phone_challenges;
begin
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' or p_hash is null or length(p_hash) not between 16 and 512 then
    raise exception 'valid phone challenge required' using errcode='22023'; end if;
  -- New delivery invalidates older pending challenges for this subject.
  update private.verification_phone_challenges set expires_at=greatest(created_at+interval '1 microsecond',clock_timestamp())
    where owner_id=p_owner and verified_at is null and expires_at>clock_timestamp();
  insert into private.verification_phone_challenges(owner_id,phone,otp_hash) values(p_owner,p_phone,p_hash) returning * into challenge;
  return jsonb_build_object('challenge_id',challenge.id,'expires_at',challenge.expires_at);
end;
$$;
revoke all on function internal.create_verification_phone_challenge(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.create_verification_phone_challenge(uuid,text,text) to service_role;
create function api.create_verification_phone_challenge(p_owner uuid,p_phone text,p_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.create_verification_phone_challenge(p_owner,p_phone,p_hash);
$$;
revoke all on function api.create_verification_phone_challenge(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.create_verification_phone_challenge(uuid,text,text) to service_role;

create function internal.claim_verification_phone_attempt(p_owner uuid,p_challenge uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare challenge private.verification_phone_challenges;
begin
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  update private.verification_phone_challenges set attempts=attempts+1
    where id=p_challenge and owner_id=p_owner and verified_at is null and expires_at>clock_timestamp() and attempts<5 returning * into challenge;
  if not found then raise exception 'challenge unavailable' using errcode='PT409'; end if;
  -- Trusted OTP adapter only. Never return the stored hash to a member/browser.
  return jsonb_build_object('challenge_id',challenge.id,'phone',challenge.phone,'otp_hash',challenge.otp_hash);
end;
$$;
revoke all on function internal.claim_verification_phone_attempt(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.claim_verification_phone_attempt(uuid,uuid) to service_role;
create function api.claim_verification_phone_attempt(p_owner uuid,p_challenge uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.claim_verification_phone_attempt(p_owner,p_challenge);
$$;
revoke all on function api.claim_verification_phone_attempt(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.claim_verification_phone_attempt(uuid,uuid) to service_role;

create function internal.finalize_verification_phone(p_owner uuid,p_challenge uuid,p_expected_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare challenge private.verification_phone_challenges; old_proof private.verification_phone_proofs; proof private.verification_phone_proofs;
begin
  perform internal.lock_verification_subject(p_owner);
  select * into challenge from private.verification_phone_challenges c where c.id=p_challenge and c.owner_id=p_owner for update;
  if not found or p_expected_hash is null or challenge.otp_hash<>p_expected_hash then
    raise exception 'challenge unavailable' using errcode='22023'; end if;
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  select * into old_proof from private.verification_phone_proofs f where f.owner_id=p_owner and f.revoked_at is null for update;
  if challenge.verified_at is not null then
    if old_proof.challenge_id=challenge.id and old_proof.phone=challenge.phone then
      return jsonb_build_object('verified',true,'reused',true,'proof_id',old_proof.id); end if;
    raise exception 'proof was superseded' using errcode='PT409';
  end if;
  if challenge.expires_at<=clock_timestamp() or challenge.attempts not between 1 and 5 then
    raise exception 'challenge unavailable' using errcode='22023'; end if;
  if old_proof.id is not null and old_proof.phone<>challenge.phone and
    (old_proof.contact_changed_at+interval '15 days'>clock_timestamp() or internal.current_verified_identity(p_owner) is null) then
    raise exception 'contact change not eligible' using errcode='PT409'; end if;
  update private.verification_phone_proofs set revoked_at=clock_timestamp() where id=old_proof.id;
  insert into private.verification_phone_proofs(owner_id,challenge_id,phone,contact_changed_at)
    values(p_owner,challenge.id,challenge.phone,case when old_proof.phone=challenge.phone then old_proof.contact_changed_at else clock_timestamp() end) returning * into proof;
  update private.verification_phone_challenges set verified_at=proof.verified_at where id=challenge.id;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('verification_phone_confirmed',proof.id,p_owner,'verification_phone_confirmed:'||proof.id);
  return jsonb_build_object('verified',true,'reused',false,'proof_id',proof.id);
end;
$$;
revoke all on function internal.finalize_verification_phone(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.finalize_verification_phone(uuid,uuid,text) to service_role;
create function api.finalize_verification_phone(p_owner uuid,p_challenge uuid,p_expected_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.finalize_verification_phone(p_owner,p_challenge,p_expected_hash);
$$;
revoke all on function api.finalize_verification_phone(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.finalize_verification_phone(uuid,uuid,text) to service_role;

create function internal.register_identity_submission(p_case uuid,p_expected_version integer,p_id_artifact uuid,p_selfie_artifact uuid,
  p_fingerprint text,p_identity_key text,p_encrypted_number jsonb,p_receipt uuid,p_risk_score integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c private.evidence_cases; s private.verification_identity_submissions; subject uuid;
begin
  if p_expected_version is null or p_expected_version not between 1 and 2147483646
    or p_fingerprint is null or p_fingerprint !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or p_identity_key is distinct from 'identity-match-v1' or p_receipt is null
    or p_risk_score is null or p_risk_score not between 0 and 100
    or p_encrypted_number is null or jsonb_typeof(p_encrypted_number)<>'object'
    or jsonb_typeof(p_encrypted_number->'ciphertext') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'iv') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'tag') is distinct from 'string'
    or jsonb_typeof(p_encrypted_number->'key_id') is distinct from 'string'
    or not(p_encrypted_number ?& array['ciphertext','iv','tag','key_id'])
    or p_encrypted_number-array['ciphertext','iv','tag','key_id']<>'{}'::jsonb
    or p_encrypted_number->>'ciphertext' !~ '^[a-f0-9]{26}$'
    or p_encrypted_number->>'iv' !~ '^[a-f0-9]{24}$' or p_encrypted_number->>'tag' !~ '^[a-f0-9]{32}$'
    or p_encrypted_number->>'key_id' is distinct from 'identity-number-v1' then
    raise exception 'bound processing receipt required' using errcode='22023'; end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case;
  if c.kind<>'kyc' or not exists(select 1 from private.current_account_access a where a.id=subject) then
    raise exception 'active identity case required' using errcode='42501'; end if;
  if exists(select 1 from private.accepted_identity_facts f where f.owner_id=subject) then
    raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
  if c.status<>'open' then raise exception 'open identity case required' using errcode='42501'; end if;
  if exists(select 1 from private.decisions d where d.case_id=c.id and d.status='proposed'
    and d.action='approve_override' and d.payload ? 'identity_submission_id') then
    raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  select x.* into s from private.verification_identity_submissions x where x.receipt_id=p_receipt;
  if found then
    if (s.case_id,s.owner_id,s.case_version,s.id_artifact_id,s.selfie_artifact_id,s.identity_hmac,s.identity_key_id,
        s.number_ciphertext,s.number_iv,s.number_tag,s.encryption_key_id,s.risk_score)
      is distinct from (c.id,subject,p_expected_version+1,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,
        p_encrypted_number->>'ciphertext',p_encrypted_number->>'iv',p_encrypted_number->>'tag',p_encrypted_number->>'key_id',p_risk_score)
      or c.version<>s.case_version or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id)
      or not internal.verification_artifacts_ready(s.id) then
      raise exception 'receipt retry conflicts with current submission' using errcode='PT409'; end if;
    return jsonb_build_object('submission_id',s.id,'case_version',s.case_version,'reused',true);
  end if;
  if c.version<>p_expected_version then raise exception 'case changed' using errcode='PT409'; end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=p_id_artifact and a.case_id=c.id and a.owner_id=subject
      and a.purpose='id_front' and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp()))
    or not exists(select 1 from private.evidence_artifacts a where a.id=p_selfie_artifact and a.case_id=c.id and a.owner_id=subject
      and a.purpose='selfie' and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp())) then
    raise exception 'clean subject-bound document and selfie required' using errcode='22023'; end if;
  if exists(select 1 from private.evidence_cases e where e.subject_id=subject and e.status='open' and e.kind in('kyc','business') and e.version=2147483647) then
    raise exception 'case revision exhausted' using errcode='22023'; end if;
  -- A typed-number/receipt replacement also invalidates other pending subject decisions.
  update private.evidence_cases set version=version+1 where subject_id=subject and status='open' and kind in('kyc','business');
  update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=subject and revoked_at is null;
  insert into private.verification_identity_submissions(case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,
    identity_hmac,identity_key_id,number_ciphertext,number_iv,number_tag,encryption_key_id,receipt_id,recipe,risk_score)
  values(c.id,subject,c.version+1,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,
    p_encrypted_number->>'ciphertext',p_encrypted_number->>'iv',p_encrypted_number->>'tag',p_encrypted_number->>'key_id',p_receipt,'manual-id-selfie-v1',p_risk_score)
  returning * into s;
  insert into private.verification_current_submissions(case_id,submission_id) values(c.id,s.id)
    on conflict(case_id) do update set submission_id=excluded.submission_id;
  return jsonb_build_object('submission_id',s.id,'case_version',s.case_version,'reused',false);
end;
$$;
revoke all on function internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) to service_role;
create function api.register_identity_submission(p_case uuid,p_expected_version integer,p_id_artifact uuid,p_selfie_artifact uuid,
  p_fingerprint text,p_identity_key text,p_encrypted_number jsonb,p_receipt uuid,p_risk_score integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.register_identity_submission(p_case,p_expected_version,p_id_artifact,p_selfie_artifact,p_fingerprint,p_identity_key,p_encrypted_number,p_receipt,p_risk_score);
$$;
revoke all on function api.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function api.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer) to service_role;

create function internal.accept_identity_submission(p_submission uuid,p_reviewer uuid,p_second uuid,p_decision uuid,
  p_claim_generation text,p_claim_nonce uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare s private.verification_identity_submissions; c private.evidence_cases; fact uuid; actor uuid;
begin
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found then raise exception 'submission unavailable' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.identity_hmac,2701));
  actor:=internal.staff_actor(case when p_second is null then 'verification:decide_routine' else 'decision:approve' end);
  if exists(select 1 from private.banned_identities b where b.identity_hmac=s.identity_hmac and b.retain_until>clock_timestamp()) then
    raise exception 'identity cannot be accepted' using errcode='42501'; end if;
  if actor is distinct from coalesce(p_second,p_reviewer) or s.owner_id in(p_reviewer,p_second)
    or not exists(select 1 from private.current_account_access a where a.id=s.owner_id) then
    raise exception 'independent current review required' using errcode='42501'; end if;
  if p_second is not null and not exists(
    select 1 from private.identity_review_proposals r join private.decisions d on d.id=r.decision_id
    join auth.sessions session on session.id=r.reviewer_session and session.user_id=p_reviewer
    join private.staff_roles role on role.user_id=p_reviewer and role.revoked_at is null
    join private.staff_capabilities capability on capability.role=role.role and capability.capability='verification:decide_routine'
    where r.decision_id=p_decision and r.submission_id=s.id and d.status='approved' and d.proposed_by=p_reviewer
      and d.approved_by=p_second and d.case_id=s.case_id and d.case_version=s.case_version
      and r.reviewed_at+interval '15 minutes'>clock_timestamp() and session.aal='aal2'
      and (session.not_after is null or session.not_after>clock_timestamp())
      and exists(select 1 from private.current_account_access a where a.id=p_reviewer)) then
    raise exception 'current independent first review required' using errcode='42501'; end if;
  select e.* into c from private.evidence_cases e where e.id=s.case_id;
  if c.status<>'open' or c.version<>s.case_version or not internal.verification_artifacts_ready(s.id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  if p_second is null then perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce); end if;
  if exists(select 1 from private.accepted_identity_facts f where f.identity_hmac=s.identity_hmac and f.revoked_at is null) then
    raise exception 'identity already accepted' using errcode='PT409'; end if;
  insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,second_reviewer,decision_id)
    values(s.owner_id,s.id,s.identity_hmac,p_reviewer,p_second,p_decision) returning id into fact;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('identity_accepted',fact,s.owner_id,'identity_accepted:'||fact);
  return fact;
end;
$$;
revoke all on function internal.accept_identity_submission(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

create function internal.review_identity_submission(p_submission uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,
  p_number_matches boolean,p_selfie_matches boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('verification:decide_routine'); s private.verification_identity_submissions;
  c private.evidence_cases; fact uuid; proposal jsonb;
begin
  if p_number_matches is distinct from true or p_selfie_matches is distinct from true or p_expected_version is null then
    raise exception 'exact number/document and selfie attestations required' using errcode='22023'; end if;
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found then raise exception 'submission unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(s.owner_id);
  actor:=internal.staff_actor('verification:decide_routine');
  if not exists(select 1 from private.current_account_access a where a.id=s.owner_id) then
    raise exception 'active identity subject required' using errcode='42501'; end if;
  select e.* into c from private.evidence_cases e where e.id=s.case_id;
  select f.id into fact from private.accepted_identity_facts f where f.submission_id=s.id and f.revoked_at is null
    and f.reviewed_by=actor and f.second_reviewer is null and s.case_version=p_expected_version;
  if found and c.status='decided' and c.version=s.case_version+1 and internal.verification_artifacts_ready(s.id) then
    return jsonb_build_object('status','accepted','identity_fact_id',fact,'reused',true); end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.kind<>'kyc' or c.version<>p_expected_version or s.case_version<>c.version
    or not internal.verification_artifacts_ready(s.id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  if s.risk_score>50 then
    proposal:=internal.propose_decision(c.id,c.version,'approve_override',jsonb_build_object('identity_submission_id',s.id));
    insert into private.identity_review_proposals(decision_id,submission_id,reviewer_session)
      values((proposal->>'decision_id')::uuid,s.id,(auth.jwt()->>'session_id')::uuid);
    return jsonb_build_object('status','awaiting_second_reviewer','decision_id',proposal->>'decision_id');
  end if;
  fact:=internal.accept_identity_submission(s.id,actor,null,null,p_claim_generation,p_claim_nonce);
  update private.evidence_cases set status='decided',version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id and version<2147483647;
  if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  return jsonb_build_object('status','accepted','identity_fact_id',fact);
end;
$$;
revoke all on function internal.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) to authenticated;
create function api.review_identity_submission(p_submission uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,
  p_number_matches boolean,p_selfie_matches boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.review_identity_submission(p_submission,p_expected_version,p_claim_generation,p_claim_nonce,p_number_matches,p_selfie_matches);
$$;
revoke all on function api.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function api.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) to authenticated;

create function internal.verification_identity_fact_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.owner_id,new.submission_id,new.identity_hmac,new.reviewed_by,new.second_reviewer,new.decision_id,new.reviewed_at)
    is distinct from (old.id,old.owner_id,old.submission_id,old.identity_hmac,old.reviewed_by,old.second_reviewer,old.decision_id,old.reviewed_at)
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'accepted identity facts are immutable except first revocation' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function internal.verification_identity_fact_guard() from public,anon,authenticated,service_role;
create trigger verification_identity_fact_guard before update on private.accepted_identity_facts
  for each row execute function internal.verification_identity_fact_guard();

create function internal.verification_evidence_invalidation()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare subject uuid; case_id uuid; material boolean; changed integer;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  material:=tg_op<>'UPDATE';
  if tg_op='UPDATE' then material:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes); end if;
  if material and exists(select 1 from private.evidence_cases c where c.id=case_id and c.kind='kyc') then
    perform internal.lock_verification_subject(subject);
    update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=subject and revoked_at is null;
    get diagnostics changed=row_count;
    if changed>0 and not exists(select 1 from private.account_closures x where x.user_id=subject) then
      if exists(select 1 from private.evidence_cases c where c.subject_id=subject and c.status='open' and c.kind in('kyc','business') and c.version=2147483647) then
        raise exception 'case revision exhausted' using errcode='22023'; end if;
      update private.evidence_cases set version=version+1 where subject_id=subject and status='open' and kind in('kyc','business');
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function internal.verification_evidence_invalidation() from public,anon,authenticated,service_role;
create trigger verification_evidence_invalidation after insert or update or delete on private.evidence_artifacts
  for each row execute function internal.verification_evidence_invalidation();

create function internal.verification_closure_invalidation()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  perform internal.lock_verification_subject(new.user_id);
  update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=new.user_id and revoked_at is null;
  update private.verification_phone_proofs set revoked_at=clock_timestamp() where owner_id=new.user_id and revoked_at is null;
  return new;
end;
$$;
revoke all on function internal.verification_closure_invalidation() from public,anon,authenticated,service_role;
create trigger verification_closure_invalidation after insert on private.account_closures
  for each row execute function internal.verification_closure_invalidation();

create function internal.verification_decision_proposal_binding()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare subject uuid;
begin
  if new.action='restrict_account' and (new.payload ? 'identity_fact_id' or new.payload ? 'identity_ban_category') then
    if new.payload-array['identity_fact_id','identity_ban_category']<>'{}'::jsonb then
      raise exception 'unknown identity ban payload fields' using errcode='22023'; end if;
    select c.subject_id into subject from private.evidence_cases c where c.id=new.case_id;
    if not exists(select 1 from private.accepted_identity_facts f where f.id::text=new.payload->>'identity_fact_id'
      and f.owner_id=subject)
      or new.payload->>'identity_ban_category' is null
      or new.payload->>'identity_ban_category' not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
      raise exception 'current subject identity and explicit category required' using errcode='22023'; end if;
  elsif new.action='approve_override' and new.payload ? 'identity_submission_id' then
    if new.payload-array['identity_submission_id']<>'{}'::jsonb then
      raise exception 'unknown identity review payload fields' using errcode='22023'; end if;
  end if;
  return new;
end;
$$;
revoke all on function internal.verification_decision_proposal_binding() from public,anon,authenticated,service_role;
create trigger verification_decision_proposal_binding before insert on private.decisions
  for each row execute function internal.verification_decision_proposal_binding();

create function internal.verification_decision_effect()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare binding private.identity_review_proposals; s private.verification_identity_submissions;
  fact private.accepted_identity_facts; c private.evidence_cases; actor uuid; category text;
begin
  if new.status<>'approved' then return new; end if;
  if new.action='approve_override' and new.payload ? 'identity_submission_id' then
    select p.* into binding from private.identity_review_proposals p where p.decision_id=new.id;
    if not found or binding.submission_id::text is distinct from new.payload->>'identity_submission_id' then
      raise exception 'typed identity review proposal required' using errcode='42501'; end if;
    perform internal.accept_identity_submission(binding.submission_id,new.proposed_by,new.approved_by,new.id,null,null);
  elsif new.action='restrict_account' and (new.payload ? 'identity_fact_id' or new.payload ? 'identity_ban_category') then
    select e.* into c from private.evidence_cases e where e.id=new.case_id;
    select f.* into fact from private.accepted_identity_facts f
      where f.id::text=new.payload->>'identity_fact_id' and f.owner_id=c.subject_id;
    if not found then raise exception 'reviewed subject identity required' using errcode='PT409'; end if;
    category:=new.payload->>'identity_ban_category';
    if category is null or category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
      raise exception 'explicit identity ban category required' using errcode='22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fact.identity_hmac,2701));
    actor:=internal.staff_actor('decision:approve');
    if actor is distinct from new.approved_by then raise exception 'current independent approver required' using errcode='42501'; end if;
    insert into private.identity_ban_bindings(decision_id,fact_id,identity_hmac,category,approved_at,retain_until)
      values(new.id,fact.id,fact.identity_hmac,category,new.approved_at,new.approved_at+interval '5 years');
    perform internal.record_identity_ban(new.id,fact.identity_hmac,category);
  end if;
  return new;
end;
$$;
revoke all on function internal.verification_decision_effect() from public,anon,authenticated,service_role;
create trigger verification_decision_effect after update of status on private.decisions
  for each row when(new.status='approved' and old.status='proposed') execute function internal.verification_decision_effect();

create function internal.current_verified_identity(p_owner uuid)
returns text language sql volatile security invoker set search_path=pg_catalog as $$
  select f.identity_hmac from private.accepted_identity_facts f
    join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases c on c.id=s.case_id and c.subject_id=p_owner
  where f.owner_id=p_owner and f.revoked_at is null and c.status='decided' and c.version=s.case_version+1
    and internal.verification_artifacts_ready(s.id)
    and exists(select 1 from private.current_account_access a where a.id=p_owner)
    and exists(select 1 from private.verification_phone_proofs p where p.owner_id=p_owner and p.revoked_at is null)
    and exists(select 1 from private.verification_localities l where l.owner_id=p_owner);
$$;
revoke all on function internal.current_verified_identity(uuid) from public,anon,authenticated,service_role;

create function internal.grant_verified_intro_trial(p_owner uuid,p_days integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare fingerprint text;
begin
  perform internal.lock_verification_subject(p_owner);
  fingerprint:=internal.current_verified_identity(p_owner);
  if fingerprint is null then raise exception 'current complete verification required' using errcode='42501'; end if;
  if exists(select 1 from private.trial_identities t where t.owner_id=p_owner and t.identity_hmac<>fingerprint) then
    return jsonb_build_object('granted',false,'reason','account_already_used'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,2701));
  if internal.current_verified_identity(p_owner) is distinct from fingerprint then
    raise exception 'verification changed' using errcode='42501'; end if;
  return internal.grant_intro_trial(p_owner,fingerprint,p_days);
end;
$$;
revoke all on function internal.grant_verified_intro_trial(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.grant_verified_intro_trial(uuid,integer) to service_role;
create function api.grant_verified_intro_trial(p_owner uuid,p_days integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.grant_verified_intro_trial(p_owner,p_days);
$$;
revoke all on function api.grant_verified_intro_trial(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function api.grant_verified_intro_trial(uuid,integer) to service_role;

create function internal.reconcile_verified_identity_ban(p_decision uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare binding private.identity_ban_bindings; subject uuid;
begin
  select c.subject_id into subject from private.decisions d join private.evidence_cases c on c.id=d.case_id
    where d.id=p_decision and d.status='approved' and d.action='restrict_account';
  if not found then raise exception 'approved identity ban required' using errcode='42501'; end if;
  perform internal.lock_verification_subject(subject);
  select b.* into binding from private.identity_ban_bindings b where b.decision_id=p_decision;
  if not found then raise exception 'reviewed identity ban binding unavailable' using errcode='42501'; end if;
  return internal.record_identity_ban(binding.decision_id,binding.identity_hmac,binding.category);
end;
$$;
revoke all on function internal.reconcile_verified_identity_ban(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.reconcile_verified_identity_ban(uuid) to service_role;
create function api.reconcile_verified_identity_ban(p_decision uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.reconcile_verified_identity_ban(p_decision);
$$;
revoke all on function api.reconcile_verified_identity_ban(uuid) from public,anon,authenticated,service_role;
grant execute on function api.reconcile_verified_identity_ban(uuid) to service_role;

-- Staff can open a restriction case without cooperation from the verified owner.
-- An explicit operation UUID makes a lost-response retry return the same decision.
create function internal.propose_verified_identity_ban(p_owner uuid,p_fact uuid,p_category text,p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:propose'); prior private.identity_ban_proposal_requests;
  case_id uuid; proposal jsonb;
begin
  if p_request is null or p_owner is null or p_fact is null or p_category is null
    or p_category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
    raise exception 'bound identity ban request required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  actor:=internal.staff_actor('decision:propose');
  if actor=p_owner then raise exception 'independent review required' using errcode='42501'; end if;
  select r.* into prior from private.identity_ban_proposal_requests r where r.id=p_request;
  if found then
    if (prior.owner_id,prior.fact_id,prior.category) is distinct from (p_owner,p_fact,p_category) then
      raise exception 'conflicting identity ban request' using errcode='PT409'; end if;
    return jsonb_build_object('decision_id',prior.decision_id,'reused',true);
  end if;
  -- Readiness revocation by a new owner upload never erases historical review.
  -- Staff deliberately select the immutable accepted fact being enforced.
  if not exists(select 1 from private.accepted_identity_facts f where f.id=p_fact and f.owner_id=p_owner) then
    raise exception 'reviewed subject identity required' using errcode='22023'; end if;
  insert into private.evidence_cases(subject_id,kind) values(p_owner,'restriction') returning id into case_id;
  proposal:=internal.propose_decision(case_id,1,'restrict_account',jsonb_build_object('identity_fact_id',p_fact,'identity_ban_category',p_category));
  insert into private.identity_ban_proposal_requests(id,owner_id,fact_id,category,decision_id)
    values(p_request,p_owner,p_fact,p_category,(proposal->>'decision_id')::uuid);
  return jsonb_build_object('decision_id',proposal->>'decision_id','reused',false);
end;
$$;
revoke all on function internal.propose_verified_identity_ban(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.propose_verified_identity_ban(uuid,uuid,text,uuid) to authenticated;
create function api.propose_verified_identity_ban(p_owner uuid,p_fact uuid,p_category text,p_request uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.propose_verified_identity_ban(p_owner,p_fact,p_category,p_request);
$$;
revoke all on function api.propose_verified_identity_ban(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.propose_verified_identity_ban(uuid,uuid,text,uuid) to authenticated;

create function internal.staff_identity_review_context(p_case uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:view'); subject uuid; c private.evidence_cases;
  s private.verification_identity_submissions;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  actor:=internal.staff_actor('evidence:view');
  select e.* into c from private.evidence_cases e where e.id=p_case;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select x.* into s from private.verification_identity_submissions x join private.verification_current_submissions v
    on v.submission_id=x.id and v.case_id=c.id;
  if not found or s.case_version<>c.version or not internal.verification_artifacts_ready(s.id) then
    raise exception 'current submission unavailable' using errcode='PT409'; end if;
  insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
    values(actor,c.id,'routine_review',c.version,c.claim_generation,array[s.id_artifact_id,s.selfie_artifact_id]);
  actor:=internal.staff_actor('evidence:view');
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'submission_id',s.id,'risk_score',s.risk_score,
    'recipe',s.recipe,'id_artifact_id',s.id_artifact_id,'selfie_artifact_id',s.selfie_artifact_id);
end;
$$;
revoke all on function internal.staff_identity_review_context(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_identity_review_context(uuid,text,uuid) to authenticated;
create function api.staff_identity_review_context(p_case uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.staff_identity_review_context(p_case,p_claim_generation,p_claim_nonce);
$$;
revoke all on function api.staff_identity_review_context(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.staff_identity_review_context(uuid,text,uuid) to authenticated;

-- Staff discovery of opaque accepted-identity references. No raw identity data.
create index accepted_identity_history_owner_idx on private.accepted_identity_facts(owner_id,reviewed_at desc,id desc);
create index decisions_case_lookup_idx on private.decisions(case_id,id);
alter table private.evidence_access_log add column identity_fact_ids uuid[] not null default '{}';
create function internal.staff_identity_history(p_owner uuid,p_before_time timestamptz,p_before_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:propose'); c private.evidence_cases;
  items jsonb; more boolean; ids uuid[]; fact_ids uuid[]; cursor jsonb;
begin
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  if p_owner is null or (p_before_time is null)<>(p_before_id is null) then
    raise exception 'subject and complete history cursor required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  actor:=internal.staff_actor('decision:propose');
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  if actor=p_owner then raise exception 'independent review required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=p_owner) then
    raise exception 'subject unavailable' using errcode='22023'; end if;
  select e.* into c from private.evidence_cases e where e.subject_id=p_owner and e.kind='restriction'
    and e.status='open' and ((e.claimed_by=actor and e.claim_expires_at>clock_timestamp())
      or ((e.claim_expires_at is null or e.claim_expires_at<=clock_timestamp()) and e.claim_generation<9223372036854775807))
    and not exists(select 1 from private.decisions d where d.case_id=e.id)
    order by (e.claimed_by=actor and e.claim_expires_at>clock_timestamp()) desc nulls last,e.created_at desc,e.id desc limit 1;
  if not found then
    insert into private.evidence_cases(subject_id,kind,claimed_by,claim_expires_at,claim_generation,claim_nonce)
      values(p_owner,'restriction',actor,clock_timestamp()+interval '30 minutes',1,pg_catalog.gen_random_uuid()) returning * into c;
  elsif c.claimed_by is distinct from actor or c.claim_expires_at is null or c.claim_expires_at<=clock_timestamp() then
    update private.evidence_cases set claimed_by=actor,claim_expires_at=clock_timestamp()+interval '30 minutes',
      claim_generation=claim_generation+1,claim_nonce=pg_catalog.gen_random_uuid() where id=c.id and claim_generation<9223372036854775807 returning * into c;
    if not found then raise exception 'claim generation exhausted' using errcode='PT409'; end if;
  end if;
  perform internal.assert_evidence_claim(c,actor,c.claim_generation::text,c.claim_nonce);
  select coalesce(jsonb_agg(jsonb_build_object('identity_fact_id',f.id,'submission_id',f.submission_id,
    'reviewed_at',f.reviewed_at,'identity_is_current',f.revoked_at is null) order by f.reviewed_at desc,f.id desc),'[]'::jsonb)
    into items from (select x.* from private.accepted_identity_facts x where x.owner_id=p_owner
      and (p_before_time is null or (x.reviewed_at,x.id)<(p_before_time,p_before_id))
      order by x.reviewed_at desc,x.id desc limit 21) f;
  more:=jsonb_array_length(items)>20;
  if more then items:=items-20; end if;
  select coalesce(array_agg(distinct artifact),'{}'::uuid[]) into ids
    from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    cross join lateral unnest(array[s.id_artifact_id,s.selfie_artifact_id]) artifact
    where f.owner_id=p_owner and f.id in(select (j->>'identity_fact_id')::uuid from jsonb_array_elements(items) j);
  select coalesce(array_agg((j->>'identity_fact_id')::uuid),'{}'::uuid[]) into fact_ids from jsonb_array_elements(items) j;
  insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids,identity_fact_ids)
    values(actor,c.id,'identity_enforcement_review',c.version,c.claim_generation,ids,fact_ids);
  actor:=internal.staff_actor('decision:propose');
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  perform internal.assert_evidence_claim(c,actor,c.claim_generation::text,c.claim_nonce);
  if more then
    cursor:=jsonb_build_object('before_time',items->(jsonb_array_length(items)-1)->>'reviewed_at',
      'before_id',items->(jsonb_array_length(items)-1)->>'identity_fact_id');
  end if;
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at',c.claim_expires_at,'identities',items,'next_cursor',cursor);
end;
$$;
revoke all on function internal.staff_identity_history(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_identity_history(uuid,timestamptz,uuid) to authenticated;
create function api.staff_identity_history(p_owner uuid,p_before_time timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.staff_identity_history(p_owner,p_before_time,p_before_id);
$$;
revoke all on function api.staff_identity_history(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function api.staff_identity_history(uuid,timestamptz,uuid) to authenticated;

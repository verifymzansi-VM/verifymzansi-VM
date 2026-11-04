-- Preserve the selected wizard's separate ID/selfie requests. The transport
-- receipts reference native evidence; they confer no verification authority.
begin;
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.get_my_verification_case()'::regprocedure)
    <> 'b3b7ae038fadf4b5cb2d535e5a1e899e' then
    raise exception 'verification status definition changed';
  end if;
  -- current_verified_identity returns a fingerprint, never a fact UUID.
  execute replace(pg_get_functiondef('internal.get_my_verification_case()'::regprocedure),
    'fact uuid;', 'fact text;');
end$$;

create table private.frontend_verification_uploads (
  owner_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  session_id uuid not null,
  case_id uuid not null,
  case_version integer not null check(case_version>0),
  purpose text not null check(purpose in('id_front','selfie')),
  request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
  artifact_id uuid not null unique references private.evidence_artifacts(id) on delete restrict,
  id_request uuid,
  fingerprint text check(fingerprint ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  encrypted_number jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  completed_at timestamptz,
  submission_id uuid references private.verification_identity_submissions(id) on delete restrict,
  primary key(owner_id,request_id),
  foreign key(case_id,owner_id) references private.evidence_cases(id,subject_id) on delete restrict,
  foreign key(owner_id,id_request) references private.frontend_verification_uploads(owner_id,request_id) on delete restrict,
  check(expires_at>created_at),
  check(purpose='id_front' or (fingerprint is null and encrypted_number is null)),
  check((fingerprint is null)=(encrypted_number is null))
);
create index frontend_verification_case_idx on private.frontend_verification_uploads(owner_id,case_id,purpose,created_at desc);
alter table private.frontend_verification_uploads enable row level security;
revoke all on private.frontend_verification_uploads from public,anon,authenticated,service_role;

create function internal.reserve_frontend_verification_upload(p_request uuid,p_purpose text,p_digest text,
  p_first_name text default null,p_last_name text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); old private.frontend_verification_uploads;
  opened jsonb; reserved jsonb; prior uuid; profile private.profiles; version integer;
begin
  if p_request is null or p_purpose is null or p_purpose not in('id_front','selfie')
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'upload request required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  perform internal.price_draft_actor();
  select * into old from private.frontend_verification_uploads where owner_id=actor and request_id=p_request;
  if found then
    if old.request_digest<>p_digest or old.purpose<>p_purpose or old.expires_at<=clock_timestamp() then
      raise exception 'upload request changed or expired' using errcode='PT409'; end if;
    return jsonb_build_object('artifact_id',old.artifact_id,'completed',old.completed_at is not null);
  end if;
  if p_purpose='id_front' then
    select * into profile from private.profiles where account_id=actor for update;
    if (profile.legal_first_name,profile.legal_last_name) is distinct from (p_first_name,p_last_name) then
      perform internal.save_my_legal_name(profile.revision,p_first_name,p_last_name);
    end if;
  elsif p_first_name is not null or p_last_name is not null then
    raise exception 'unexpected names' using errcode='22023';
  end if;
  opened:=internal.open_verification_case();
  if (opened->>'read_only')::boolean then
    raise exception 'identity is accepted or under independent review' using errcode='PT409'; end if;
  if p_purpose='selfie' then
    select r.request_id into prior from private.frontend_verification_uploads r
      join private.evidence_artifacts a on a.id=r.artifact_id and a.owner_id=r.owner_id and a.case_id=r.case_id
      where r.owner_id=actor and r.case_id=(opened->>'case_id')::uuid and r.purpose='id_front'
      and r.completed_at is not null and r.expires_at>clock_timestamp() and r.fingerprint is not null
      and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp())
      order by r.created_at desc,r.request_id limit 1;
    if prior is null then raise exception 'upload the ID document first' using errcode='PT409'; end if;
  end if;
  reserved:=internal.begin_evidence_upload((opened->>'case_id')::uuid,p_purpose);
  select c.version into version from private.evidence_cases c where c.id=(opened->>'case_id')::uuid;
  insert into private.frontend_verification_uploads(owner_id,request_id,session_id,case_id,case_version,purpose,request_digest,artifact_id,id_request)
    values(actor,p_request,(auth.jwt()->>'session_id')::uuid,(opened->>'case_id')::uuid,version,p_purpose,p_digest,
      (reserved->>'artifact_id')::uuid,prior);
  perform internal.price_draft_actor();
  return jsonb_build_object('artifact_id',(reserved->>'artifact_id')::uuid,'completed',false);
end$$;
revoke all on function internal.reserve_frontend_verification_upload(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.reserve_frontend_verification_upload(uuid,text,text,text,text) to authenticated;
create function api.reserve_frontend_verification_upload(p_request uuid,p_purpose text,p_digest text,p_first_name text default null,p_last_name text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select internal.reserve_frontend_verification_upload(p_request,p_purpose,p_digest,p_first_name,p_last_name);
$$;
revoke all on function api.reserve_frontend_verification_upload(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.reserve_frontend_verification_upload(uuid,text,text,text,text) to authenticated;

-- No raw number or encryption secret enters SQL. This service-only view resolves
-- uncertain completions and supplies the bound ID receipt for selfie assessment.
create function internal.frontend_verification_upload_context(p_owner uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r private.frontend_verification_uploads; id private.frontend_verification_uploads; a private.evidence_artifacts;
begin
  perform internal.lock_verification_subject(p_owner);
  select * into r from private.frontend_verification_uploads where owner_id=p_owner and request_id=p_request;
  if not found or not exists(select 1 from private.current_account_access x where x.id=p_owner) then
    raise exception 'upload unavailable' using errcode='42501'; end if;
  select e.* into a from private.evidence_artifacts e where e.id=r.artifact_id and e.owner_id=p_owner and e.case_id=r.case_id;
  if a.id is null or a.state not in('intent','clean') or (a.retain_until is not null and a.retain_until<=clock_timestamp()) then
    raise exception 'artifact unavailable' using errcode='PT409'; end if;
  if r.completed_at is not null then
    return jsonb_build_object('completed',true,'artifact_id',r.artifact_id,'purpose',r.purpose);
  end if;
  if r.expires_at<=clock_timestamp() or not exists(select 1 from auth.sessions s where s.id=r.session_id
    and s.user_id=p_owner and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'upload session expired' using errcode='42501'; end if;
  if not exists(select 1 from private.evidence_cases c where c.id=r.case_id and c.subject_id=p_owner and c.status='open' and c.version=r.case_version) then
    raise exception 'identity case changed' using errcode='PT409'; end if;
  if r.purpose='selfie' then
    select * into id from private.frontend_verification_uploads where owner_id=p_owner and request_id=r.id_request;
    if id.completed_at is null or id.expires_at<=clock_timestamp() or id.fingerprint is null
      or not exists(select 1 from private.evidence_artifacts e where e.id=id.artifact_id and e.state='clean') then
      raise exception 'ID upload changed' using errcode='PT409'; end if;
  end if;
  return jsonb_build_object('completed',false,'artifact_id',r.artifact_id,'purpose',r.purpose,'case_id',r.case_id,
    'object_key',a.object_key,'fingerprint',id.fingerprint,'document_sha256',
    (select e.content_sha256 from private.evidence_artifacts e where e.id=id.artifact_id));
end$$;
revoke all on function internal.frontend_verification_upload_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.frontend_verification_upload_context(uuid,uuid) to service_role;
create function api.frontend_verification_upload_context(p_owner uuid,p_request uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.frontend_verification_upload_context(p_owner,p_request)$$;
revoke all on function api.frontend_verification_upload_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.frontend_verification_upload_context(uuid,uuid) to service_role;

create function internal.complete_frontend_verification_upload(p_owner uuid,p_request uuid,p_stored_sha256 text,
  p_content_sha256 text,p_size integer,p_identity jsonb default null,p_risk_score integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare ctx jsonb; r private.frontend_verification_uploads; id private.frontend_verification_uploads; done jsonb; submitted jsonb;
begin
  ctx:=internal.frontend_verification_upload_context(p_owner,p_request);
  if (ctx->>'completed')::boolean then return ctx; end if;
  select * into r from private.frontend_verification_uploads where owner_id=p_owner and request_id=p_request;
  if r.purpose='id_front' then
    if p_identity is null or jsonb_typeof(p_identity)<>'object' or p_identity-array['fingerprint','encrypted_number']<>'{}'::jsonb
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
  elsif p_identity is not null or p_risk_score is null or p_risk_score not between 0 and 100 then
    raise exception 'server assessment required' using errcode='22023';
  end if;
  done:=internal.complete_evidence_upload(r.artifact_id,p_stored_sha256,p_content_sha256,p_size);
  if r.purpose='selfie' then
    select * into id from private.frontend_verification_uploads where owner_id=p_owner and request_id=r.id_request;
    submitted:=internal.register_identity_submission(r.case_id,(done->>'case_version')::integer,id.artifact_id,r.artifact_id,
      id.fingerprint,'identity-match-v1',id.encrypted_number,r.request_id,p_risk_score);
    update private.frontend_verification_uploads set fingerprint=null,encrypted_number=null
      where owner_id=p_owner and request_id=r.id_request;
  end if;
  update private.frontend_verification_uploads set completed_at=clock_timestamp(),
    fingerprint=case when r.purpose='id_front' then p_identity->>'fingerprint' end,
    encrypted_number=case when r.purpose='id_front' then p_identity->'encrypted_number' end,
    submission_id=(submitted->>'submission_id')::uuid where owner_id=p_owner and request_id=p_request;
  -- Session revocation during an in-flight object write must prevent submission.
  if not exists(select 1 from auth.sessions s where s.id=r.session_id and s.user_id=p_owner
    and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'upload session expired' using errcode='42501'; end if;
  return jsonb_build_object('completed',true,'artifact_id',r.artifact_id,'purpose',r.purpose);
end$$;
revoke all on function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) to service_role;
create function api.complete_frontend_verification_upload(p_owner uuid,p_request uuid,p_stored_sha256 text,p_content_sha256 text,
  p_size integer,p_identity jsonb default null,p_risk_score integer default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select internal.complete_frontend_verification_upload(p_owner,p_request,p_stored_sha256,p_content_sha256,p_size,p_identity,p_risk_score);
$$;
revoke all on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) to service_role;

create function internal.get_my_frontend_verification_uploads()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('artifact_id',x.artifact_id,'case_id',x.case_id,'purpose',x.purpose,
    'submitted_at',x.completed_at,'expires_at',x.expires_at)),'[]'::jsonb) into result from (
    select distinct on(r.purpose) r.* from private.frontend_verification_uploads r
    join private.evidence_artifacts a on a.id=r.artifact_id and a.owner_id=r.owner_id and a.case_id=r.case_id
    join private.evidence_cases c on c.id=r.case_id and c.subject_id=r.owner_id and c.status='open'
    where r.owner_id=actor and r.completed_at is not null and r.expires_at>clock_timestamp() and a.state='clean'
      and (a.retain_until is null or a.retain_until>clock_timestamp())
      and not exists(select 1 from private.verification_return_requests v where v.case_id=c.id and v.case_version=c.version)
    order by r.purpose,r.created_at desc,r.request_id limit 2) x;
  perform internal.price_draft_actor();
  return result;
end$$;
revoke all on function internal.get_my_frontend_verification_uploads() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_verification_uploads() to authenticated;
create function api.get_my_frontend_verification_uploads() returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_verification_uploads()$$;
revoke all on function api.get_my_frontend_verification_uploads() from public,anon,authenticated,service_role;
grant execute on function api.get_my_frontend_verification_uploads() to authenticated;
create function internal.scrub_frontend_verification_receipt()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
  if new.state='deleted' then update private.frontend_verification_uploads set fingerprint=null,encrypted_number=null where artifact_id=new.id; end if;
  return new;
end$$;
revoke all on function internal.scrub_frontend_verification_receipt() from public,anon,authenticated,service_role;
create trigger scrub_frontend_verification_receipt after update of state on private.evidence_artifacts
  for each row execute function internal.scrub_frontend_verification_receipt();
notify pgrst,'reload schema';
commit;

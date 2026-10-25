-- Runtime adapters for the private media/evidence journal. Apply after the
-- identity, retention and account-session prototypes. No base tables are exposed.
alter table private.evidence_artifacts
  add column content_sha256 text check(content_sha256 ~ '^[a-f0-9]{64}$'),
  add column cleanup_token uuid,
  add column cleanup_lease_until timestamptz;

create table private.verification_return_requests(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null references private.evidence_cases(id) on delete restrict,
  case_version integer not null check(case_version>0),
  reason text not null check(length(reason) between 5 and 500),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);
alter table private.verification_return_requests enable row level security;
revoke all on private.verification_return_requests from public,anon,authenticated,service_role;
create index verification_return_requests_case_idx on private.verification_return_requests(case_id,created_at desc);

create function internal.get_my_verification_case()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); c private.evidence_cases; fact uuid; submission uuid; reason text;
begin
  fact:=internal.current_verified_identity(actor);
  select e.* into c from private.evidence_cases e where e.subject_id=actor and e.kind='kyc'
    order by e.created_at desc,e.id limit 1;
  select v.submission_id into submission from private.verification_current_submissions v
    join private.verification_identity_submissions s on s.id=v.submission_id
    where v.case_id=c.id and s.case_version=c.version;
  select r.reason into reason from private.verification_return_requests r where r.case_id=c.id and r.case_version=c.version
    order by r.created_at desc,r.id limit 1;
  return jsonb_build_object('case_id',c.id,'version',c.version,'verified',fact is not null,
    'phone_verified',exists(select 1 from private.verification_phone_proofs p where p.owner_id=actor and p.revoked_at is null),
    'locality_confirmed',exists(select 1 from private.verification_localities l where l.owner_id=actor),
    'submission_pending',submission is not null and fact is null,'return_reason',reason);
end;
$$;
revoke all on function internal.get_my_verification_case() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_verification_case() to authenticated;
create function api.get_my_verification_case() returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.get_my_verification_case(); $$;
revoke all on function api.get_my_verification_case() from public,anon,authenticated,service_role;
grant execute on function api.get_my_verification_case() to authenticated;

create function internal.evidence_upload_target(p_owner uuid,p_artifact uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare art private.evidence_artifacts;
begin
  select a.* into art from private.evidence_artifacts a join private.evidence_cases c on c.id=a.case_id
    where a.id=p_artifact and a.owner_id=p_owner and a.state='intent' and c.status='open'
      and exists(select 1 from private.current_account_access u where u.id=p_owner);
  if not found then raise exception 'owned pending artifact required' using errcode='42501'; end if;
  return jsonb_build_object('artifact_id',art.id,'case_id',art.case_id,'object_key',art.object_key,'purpose',art.purpose);
end;
$$;
revoke all on function internal.evidence_upload_target(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.evidence_upload_target(uuid,uuid) to service_role;
create function api.evidence_upload_target(p_owner uuid,p_artifact uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.evidence_upload_target(p_owner,p_artifact); $$;
revoke all on function api.evidence_upload_target(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.evidence_upload_target(uuid,uuid) to service_role;

create function internal.complete_evidence_upload(p_artifact uuid,p_stored_sha256 text,p_content_sha256 text,p_size integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'content receipt required' using errcode='22023'; end if;
  perform internal.advance_evidence_artifact(p_artifact,'uploaded',p_stored_sha256,p_size);
  update private.evidence_artifacts set content_sha256=p_content_sha256 where id=p_artifact and (content_sha256 is null or content_sha256=p_content_sha256);
  if not found then raise exception 'content receipt changed' using errcode='PT409'; end if;
  return internal.advance_evidence_artifact(p_artifact,'clean',p_stored_sha256,p_size);
end;
$$;
revoke all on function internal.complete_evidence_upload(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function internal.complete_evidence_upload(uuid,text,text,integer) to service_role;
create function api.complete_evidence_upload(p_artifact uuid,p_stored_sha256 text,p_content_sha256 text,p_size integer) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.complete_evidence_upload(p_artifact,p_stored_sha256,p_content_sha256,p_size); $$;
revoke all on function api.complete_evidence_upload(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function api.complete_evidence_upload(uuid,text,text,integer) to service_role;

create function internal.assess_identity_upload(p_owner uuid,p_fingerprint text,p_document_sha256 text,p_selfie_sha256 text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare risk integer:=0; blocked boolean;
begin
  if p_owner is null or p_fingerprint !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or p_document_sha256 !~ '^[a-f0-9]{64}$' or p_selfie_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'bounded processing receipt required' using errcode='22023'; end if;
  blocked:=exists(select 1 from private.banned_identities b where b.identity_hmac=p_fingerprint and b.retain_until>clock_timestamp());
  if exists(select 1 from private.accepted_identity_facts f where f.owner_id<>p_owner and f.identity_hmac=p_fingerprint and f.revoked_at is null)
    or exists(select 1 from private.evidence_artifacts a where a.owner_id<>p_owner and a.content_sha256 in(p_document_sha256,p_selfie_sha256) and a.state in('clean','uploaded')) then risk:=75; end if;
  if (select count(*) from private.verification_identity_submissions s where s.owner_id=p_owner and s.created_at>clock_timestamp()-interval '24 hours')>=3 then risk:=greatest(risk,80); end if;
  return jsonb_build_object('blocked',blocked,'risk_score',risk);
end;
$$;
revoke all on function internal.assess_identity_upload(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.assess_identity_upload(uuid,text,text,text) to service_role;
create function api.assess_identity_upload(p_owner uuid,p_fingerprint text,p_document_sha256 text,p_selfie_sha256 text) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.assess_identity_upload(p_owner,p_fingerprint,p_document_sha256,p_selfie_sha256); $$;
revoke all on function api.assess_identity_upload(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.assess_identity_upload(uuid,text,text,text) to service_role;

create function internal.staff_verification_queue(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim'); rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  select coalesce(jsonb_agg(row),'[]'::jsonb) into rows from(
    select jsonb_build_object('case_id',c.id,'version',c.version,'display_name',p.display_name,
      'submitted_at',s.created_at,'risk_score',s.risk_score,'decision_id',d.id,'proposed_by',d.proposed_by) as row
    from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
    join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
    join private.profiles p on p.account_id=c.subject_id
    left join private.decisions d on d.case_id=c.id and d.status='proposed' and d.action='approve_override'
    where c.kind='kyc' and c.status='open' and c.subject_id<>actor
    order by s.risk_score desc,s.created_at,c.id limit p_limit
  ) x;
  return rows;
end;
$$;
revoke all on function internal.staff_verification_queue(integer) from public,anon,authenticated,service_role;
grant execute on function internal.staff_verification_queue(integer) to authenticated;
create function api.staff_verification_queue(p_limit integer) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.staff_verification_queue(p_limit); $$;
revoke all on function api.staff_verification_queue(integer) from public,anon,authenticated,service_role;
grant execute on function api.staff_verification_queue(integer) to authenticated;

create function internal.evidence_review_object(p_case uuid,p_artifact uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare art private.evidence_artifacts; s private.verification_identity_submissions;
begin
  select a.* into art from private.evidence_artifacts a where a.id=p_artifact and a.case_id=p_case and a.state='clean'
    and (a.retain_until is null or a.retain_until>clock_timestamp());
  if not found then raise exception 'current artifact unavailable' using errcode='PT409'; end if;
  select x.* into s from private.verification_identity_submissions x join private.verification_current_submissions v on v.submission_id=x.id
    join private.evidence_cases c on c.id=x.case_id and c.version=x.case_version
    where v.case_id=p_case and p_artifact in(x.id_artifact_id,x.selfie_artifact_id);
  if not found then raise exception 'current identity submission unavailable' using errcode='PT409'; end if;
  return jsonb_build_object('artifact_id',art.id,'object_key',art.object_key,'sha256',art.sha256,'size_bytes',art.size_bytes,
    'owner_id',s.owner_id,'encrypted_number',jsonb_build_object('ciphertext',s.number_ciphertext,'iv',s.number_iv,'tag',s.number_tag,'key_id',s.encryption_key_id),
    'claimed_names',(select jsonb_build_object('first_name',n.legal_first_name,'last_name',n.legal_last_name)
      from private.identity_submission_names n where n.submission_id=s.id and n.owner_id=s.owner_id));
end;
$$;
revoke all on function internal.evidence_review_object(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.evidence_review_object(uuid,uuid) to service_role;
create function api.evidence_review_object(p_case uuid,p_artifact uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.evidence_review_object(p_case,p_artifact); $$;
revoke all on function api.evidence_review_object(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.evidence_review_object(uuid,uuid) to service_role;

create function internal.release_evidence_claim(p_case uuid,p_claim_generation text,p_claim_nonce uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim'); c private.evidence_cases;
begin
  select e.* into c from private.evidence_cases e where e.id=p_case for update;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id;
  return true;
end;
$$;
revoke all on function internal.release_evidence_claim(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.release_evidence_claim(uuid,text,uuid) to authenticated;
create function api.release_evidence_claim(p_case uuid,p_claim_generation text,p_claim_nonce uuid) returns boolean language sql security invoker set search_path=pg_catalog as $$ select internal.release_evidence_claim(p_case,p_claim_generation,p_claim_nonce); $$;
revoke all on function api.release_evidence_claim(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.release_evidence_claim(uuid,text,uuid) to authenticated;

create function internal.return_identity_submission(p_case uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('verification:decide_routine'); c private.evidence_cases; subject uuid; reason text;
begin
  reason:=internal.retention_reason(p_reason);
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case for update;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.version<>p_expected_version or c.version>=2147483647 or c.subject_id=actor
    or exists(select 1 from private.decisions d where d.case_id=c.id and d.status='proposed') then raise exception 'reviewed case changed' using errcode='PT409'; end if;
  update private.evidence_cases set version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id returning * into c;
  update private.evidence_artifacts set retain_until=statement_timestamp()+interval '90 days' where case_id=c.id and state in('clean','uploaded','rejected') and retain_until is null;
  insert into private.verification_return_requests(case_id,case_version,reason,reviewer_id) values(c.id,c.version,reason,actor);
  return jsonb_build_object('case_id',c.id,'version',c.version,'status','needs_resubmission');
end;
$$;
revoke all on function internal.return_identity_submission(uuid,integer,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.return_identity_submission(uuid,integer,text,uuid,text) to authenticated;
create function api.return_identity_submission(p_case uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,p_reason text) returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.return_identity_submission(p_case,p_expected_version,p_claim_generation,p_claim_nonce,p_reason); $$;
revoke all on function api.return_identity_submission(uuid,integer,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.return_identity_submission(uuid,integer,text,uuid,text) to authenticated;

-- Cleanup is a durable authorization boundary. A hold committed before the
-- claim prevents deletion. Once deletion is authorized, new hold requests fail
-- visibly until the pending deletion is reconciled; they cannot appear to have
-- protected bytes that are already being removed by the object store.
create function internal.evidence_deletion_hold_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare subject uuid;
begin
  if tg_table_name='legal_holds' then subject:=new.subject_id;
  else select c.subject_id into subject from private.evidence_cases c where c.id=new.case_id; end if;
  perform internal.lock_evidence_subject(subject);
  if exists(select 1 from private.evidence_artifacts a where a.owner_id=subject and a.state='cleanup_required') then
    raise exception 'evidence deletion is in progress; reconcile cleanup before placing a new hold' using errcode='PT409'; end if;
  return new;
end;
$$;
revoke all on function internal.evidence_deletion_hold_guard() from public,anon,authenticated,service_role;
create trigger evidence_deletion_legal_hold before insert on private.legal_holds for each row execute function internal.evidence_deletion_hold_guard();
create trigger evidence_deletion_fraud_hold before insert on private.evidence_fraud_holds for each row execute function internal.evidence_deletion_hold_guard();

create or replace function internal.claim_evidence_cleanup(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb:='[]'::jsonb; candidate record; art private.evidence_artifacts; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  for candidate in select a.id,a.owner_id,a.case_id from private.evidence_artifacts a
    where (a.state='intent' and a.created_at<statement_timestamp()-interval '1 hour')
      or (a.state in('uploaded','clean','rejected') and a.retain_until<=statement_timestamp())
      or (a.state='cleanup_required' and coalesce(a.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp())
    order by a.owner_id,a.case_id,a.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    perform c.id from private.evidence_cases c where c.id=candidate.case_id for update skip locked;
    if not found then continue; end if;
    select a.* into art from private.evidence_artifacts a where a.id=candidate.id for update skip locked;
    if not found then continue; end if;
    if exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null)
      or internal.evidence_fraud_held(art.case_id) then continue; end if;
    if not ((art.state='intent' and art.created_at<statement_timestamp()-interval '1 hour')
      or (art.state in('uploaded','clean','rejected') and art.retain_until<=statement_timestamp())
      or (art.state='cleanup_required' and coalesce(art.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp())) then continue; end if;
    token:=pg_catalog.gen_random_uuid();
    update private.evidence_artifacts set state='cleanup_required',cleanup_token=token,cleanup_lease_until=statement_timestamp()+interval '5 minutes' where id=art.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('artifact_id',art.id,'object_key',art.object_key,'claim_token',token,'lease_until',statement_timestamp()+interval '5 minutes'));
  end loop;
  return rows;
end;
$$;

create function internal.mark_evidence_deleted(p_artifact uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare art private.evidence_artifacts;
begin
  select a.* into art from private.evidence_artifacts a where a.id=p_artifact;
  if not found or p_claim_token is null then raise exception 'cleanup claim required' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(art.owner_id);
  if exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null) or internal.evidence_fraud_held(art.case_id) then raise exception 'hold prevents deletion' using errcode='PT409'; end if;
  if art.state='deleted' and art.cleanup_token=p_claim_token then return true; end if;
  update private.evidence_artifacts set state='deleted',deleted_at=statement_timestamp() where id=p_artifact and state='cleanup_required' and cleanup_token=p_claim_token and cleanup_lease_until>statement_timestamp();
  if not found then raise exception 'cleanup claim expired' using errcode='PT409'; end if;
  return true;
end;
$$;
revoke all on function internal.mark_evidence_deleted(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.mark_evidence_deleted(uuid,uuid) to service_role;
create function api.mark_evidence_deleted(p_artifact uuid,p_claim_token uuid) returns boolean language sql security invoker set search_path=pg_catalog as $$ select internal.mark_evidence_deleted(p_artifact,p_claim_token); $$;
revoke all on function api.mark_evidence_deleted(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.mark_evidence_deleted(uuid,uuid) to service_role;

-- Object deletion acknowledgements must carry the lease token. Preserve the
-- existing upload transitions, but remove the old unfenced HTTP delete path.
create or replace function api.advance_evidence_artifact(p_artifact_id uuid,p_state text,p_sha256 text default null,p_size integer default null)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_state='deleted' then raise exception 'use a current cleanup claim to acknowledge deletion' using errcode='22023'; end if;
  return internal.advance_evidence_artifact(p_artifact_id,p_state,p_sha256,p_size);
end;
$$;

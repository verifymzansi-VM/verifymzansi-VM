-- Registration checks use the same private evidence journal as business
-- visits. The official staff copy, never the owner's upload, supplies facts
-- for a public CIPC sticker.
begin;
alter table private.frontend_business_checks drop constraint frontend_business_checks_kind_check;
alter table private.frontend_business_checks add constraint frontend_business_checks_kind_check check(kind in('seen','cipc','cipc_link'));
create unique index frontend_business_checks_cipc_open_idx on private.frontend_business_checks(business_id)
  where kind in('cipc','cipc_link') and status in('pending','info_requested');

create table private.frontend_cipc_reviews(
  check_id uuid primary key references private.frontend_business_checks(id) on delete cascade,
  registration_number text not null check(registration_number ~ '^[0-9]{4}/[0-9]{6}/[0-9]{2}$'),
  route text not null check(route in('director','representative')),
  submitted_at timestamptz,
  owner_file uuid references private.evidence_artifacts(id) on delete set null,
  official_file uuid references private.evidence_artifacts(id) on delete set null,
  prior_check uuid references private.frontend_business_checks(id) on delete set null,
  linked_business_id uuid references private.posts(id) on delete set null,
  renewal boolean not null default false,
  use_registered_office boolean not null default false,
  display_full_office boolean not null default false,
  office_override jsonb check(office_override is null or jsonb_typeof(office_override)='object'),
  registered_name text check(length(registered_name) between 2 and 250),
  accepted_role text check(accepted_role in('director','member','representative')),
  position_title text check(length(position_title) between 1 and 120),
  registered_office jsonb check(registered_office is null or jsonb_typeof(registered_office)='object'),
  representative_email text check(length(representative_email) between 3 and 254),
  representative_position text check(length(representative_position) between 2 and 40),
  representative_verified_at timestamptz,
  domain_confirmed boolean not null default false,
  callback_confirmed boolean not null default false,
  callback_record jsonb check(callback_record is null or jsonb_typeof(callback_record)='object')
);
create index frontend_cipc_registration_idx on private.frontend_cipc_reviews(registration_number,check_id);
create index frontend_cipc_prior_idx on private.frontend_cipc_reviews(prior_check);
create index frontend_cipc_linked_business_idx on private.frontend_cipc_reviews(linked_business_id);
create index frontend_cipc_owner_file_idx on private.frontend_cipc_reviews(owner_file);
create index frontend_cipc_official_file_idx on private.frontend_cipc_reviews(official_file);
alter table private.frontend_cipc_reviews enable row level security;
revoke all on private.frontend_cipc_reviews from public,anon,authenticated,service_role;

create table private.frontend_cipc_documents(
  artifact_id uuid primary key references private.evidence_artifacts(id) on delete cascade,
  check_id uuid not null references private.frontend_cipc_reviews(check_id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  source text not null check(source in('owner_upload','admin_copy')),
  content_digest text not null check(content_digest ~ '^[0-9a-f]{64}$'),
  reviewed_version timestamptz not null,
  claim_generation text check(claim_generation is null or claim_generation ~ '^[1-9][0-9]{0,18}$'),
  claim_nonce uuid,
  summary jsonb check(summary is null or (jsonb_typeof(summary)='object' and octet_length(summary::text)<=60000)),
  owner_match_fingerprint text check(owner_match_fingerprint is null or owner_match_fingerprint ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  owner_match_position text check(length(owner_match_position) between 1 and 120),
  recorded_at timestamptz,
  unique(check_id,source,content_digest),
  check((source='owner_upload')=(claim_nonce is null)),
  check((claim_generation is null)=(claim_nonce is null)),
  check((recorded_at is null)=(summary is null))
);
create index frontend_cipc_documents_case_idx on private.frontend_cipc_documents(check_id);
create index frontend_cipc_documents_actor_idx on private.frontend_cipc_documents(actor_id);
alter table private.frontend_cipc_documents enable row level security;
revoke all on private.frontend_cipc_documents from public,anon,authenticated,service_role;

create function internal.lock_frontend_cipc_case(p_case uuid)
returns private.frontend_business_checks language plpgsql security invoker set search_path=pg_catalog as $$
declare subject uuid;x private.frontend_business_checks;
begin
  select owner_id into subject from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if subject is null then raise exception 'CIPC case unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);
  perform 1 from private.posts p join private.frontend_business_checks b on b.business_id=p.id and b.owner_id=p.owner_id
    where b.id=p_case and p.kind='business' for update of p;
  if not found then raise exception 'current business owner changed' using errcode='PT409';end if;
  perform 1 from private.evidence_cases c where c.id=p_case and c.subject_id=subject and c.status='open' for update;
  if not found then raise exception 'CIPC case is closed' using errcode='PT409';end if;
  select * into x from private.frontend_business_checks where id=p_case and status in('pending','info_requested') for update;
  if not found then raise exception 'CIPC case is closed' using errcode='PT409';end if;
  return x;
end$$;
revoke all on function internal.lock_frontend_cipc_case(uuid) from public,anon,authenticated,service_role;

create function internal.reserve_frontend_cipc_document(p_business uuid,p_number text,p_route text,p_office boolean,p_digest text,p_case uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();x private.frontend_business_checks;d private.frontend_cipc_reviews;
  art private.evidence_artifacts;prior private.frontend_cipc_documents;case_id uuid;
begin
  if p_number is null or p_number !~ '^[0-9]{4}/[0-9]{6}/[0-9]{2}$' or p_route is null or p_route not in('director','representative')
    or p_office is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$'
    then raise exception 'valid CIPC request required' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  if not internal.frontend_business_identity_reviewed(actor) then raise exception 'reviewed owner identity required' using errcode='42501';end if;
  perform 1 from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business' and p.edit_of is null
    and p.status not in('archived','sold') for update;
  if not found then raise exception 'business unavailable' using errcode='PT404';end if;
  select * into x from private.frontend_business_checks b where b.business_id=p_business and b.kind in('cipc','cipc_link')
    and b.status in('pending','info_requested') for update;
  if x.id is null then
    if p_case is not null then raise exception 'represented CIPC case is closed' using errcode='PT409';end if;
    insert into private.evidence_cases(subject_id,kind) values(actor,'business') returning id into case_id;
    insert into private.frontend_business_checks(id,business_id,owner_id,kind) values(case_id,p_business,actor,'cipc') returning * into x;
    insert into private.frontend_cipc_reviews(check_id,registration_number,route,use_registered_office)
      values(x.id,p_number,p_route,p_office) returning * into d;
  else
    if x.kind<>'cipc' or x.owner_id<>actor or (p_case is not null and p_case<>x.id) then raise exception 'another business check is open' using errcode='PT409';end if;
    select * into d from private.frontend_cipc_reviews where check_id=x.id for update;
    if d.registration_number<>p_number or (p_case is null and (d.route<>p_route or d.use_registered_office<>p_office))
      then raise exception 'represented CIPC details changed' using errcode='PT409';end if;
  end if;
  select * into prior from private.frontend_cipc_documents e where e.check_id=x.id and e.source='owner_upload' and e.content_digest=p_digest;
  if found then
    if prior.recorded_at is not null and d.owner_file=prior.artifact_id then
      return jsonb_build_object('case_id',x.id,'artifact_id',prior.artifact_id,'owner_id',actor,'completed',true);
    elsif prior.recorded_at is not null or prior.reviewed_version<>x.updated_at then raise exception 'CIPC upload changed' using errcode='PT409';end if;
    return jsonb_build_object('case_id',x.id,'artifact_id',prior.artifact_id,'owner_id',actor,'completed',false);
  end if;
  if d.submitted_at is not null and p_case is null then raise exception 'this business already has a CIPC check in review' using errcode='PT409';end if;
  if (select count(*) from private.frontend_cipc_documents e where e.check_id=x.id and e.source='owner_upload')>=10
    then raise exception 'CIPC attachment limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,actor,'registration','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_cipc_documents(artifact_id,check_id,actor_id,source,content_digest,reviewed_version)
    values(art.id,x.id,actor,'owner_upload',p_digest,x.updated_at);
  return jsonb_build_object('case_id',x.id,'artifact_id',art.id,'owner_id',actor,'completed',false);
end$$;
create function api.reserve_frontend_cipc_document(p_business uuid,p_number text,p_route text,p_office boolean,p_digest text,p_case uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.reserve_frontend_cipc_document(p_business,p_number,p_route,p_office,p_digest,p_case)$$;

create function internal.reserve_frontend_cipc_official(p_case uuid,p_expected timestamptz,p_generation text,p_nonce uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:view');x private.frontend_business_checks;art private.evidence_artifacts;
  prior private.frontend_cipc_documents;c private.evidence_cases;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'official PDF digest required' using errcode='22023';end if;
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('evidence:view');
  if x.kind<>'cipc' or x.owner_id=actor then raise exception 'independent official copy review required' using errcode='42501';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if x.updated_at is distinct from p_expected or not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=x.id and d.submitted_at is not null)
    then raise exception 'CIPC check changed' using errcode='PT409';end if;
  select * into prior from private.frontend_cipc_documents d where d.check_id=x.id and d.source='admin_copy' and d.content_digest=p_digest;
  if found then
    if prior.actor_id is distinct from actor or (prior.recorded_at is null and (prior.reviewed_version<>x.updated_at or prior.claim_generation<>p_generation or prior.claim_nonce<>p_nonce))
      then raise exception 'official copy scope changed' using errcode='PT409';end if;
    if prior.recorded_at is not null and not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=x.id and d.official_file=prior.artifact_id)
      then raise exception 'this official copy is superseded' using errcode='PT409';end if;
    return jsonb_build_object('case_id',x.id,'artifact_id',prior.artifact_id,'owner_id',x.owner_id,'completed',prior.recorded_at is not null);
  end if;
  if (select count(*) from private.frontend_cipc_documents d where d.check_id=x.id and d.source='admin_copy')>=10
    then raise exception 'official copy attachment limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,x.owner_id,'registration','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_cipc_documents(artifact_id,check_id,actor_id,source,content_digest,reviewed_version,claim_generation,claim_nonce)
    values(art.id,x.id,actor,'admin_copy',p_digest,x.updated_at,p_generation,p_nonce);
  return jsonb_build_object('case_id',x.id,'artifact_id',art.id,'owner_id',x.owner_id,'completed',false);
end$$;
create function api.reserve_frontend_cipc_official(p_case uuid,p_expected timestamptz,p_generation text,p_nonce uuid,p_digest text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.reserve_frontend_cipc_official(p_case,p_expected,p_generation,p_nonce,p_digest)$$;

create function internal.record_frontend_cipc_parse(p_actor uuid,p_session uuid,p_artifact uuid,p_summary jsonb,p_directors jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare case_id uuid;x private.frontend_business_checks;e private.frontend_cipc_documents;c private.evidence_cases;
  d private.frontend_cipc_reviews;match_fingerprint text;match_position text;receipt jsonb;now_at timestamptz;
begin
  if p_summary is null or jsonb_typeof(p_summary)<>'object' or octet_length(p_summary::text)>50000
    or exists(select 1 from jsonb_object_keys(p_summary) k where k not in('registrationNumber','registeredName','enterpriseStatus','issuedOn','docType','registeredOffice','registeredOfficeLines','cipcReference','findings'))
    or p_directors is null or jsonb_typeof(p_directors)<>'array' or jsonb_array_length(p_directors)>100
    or octet_length(p_directors::text)>35000
    then raise exception 'validated CIPC parse receipt required' using errcode='22023';end if;
  select check_id into case_id from private.frontend_cipc_documents where artifact_id=p_artifact and actor_id=p_actor;
  if case_id is null then raise exception 'CIPC upload unavailable' using errcode='PT404';end if;
  x:=internal.lock_frontend_cipc_case(case_id);now_at:=clock_timestamp();
  select * into e from private.frontend_cipc_documents where artifact_id=p_artifact and actor_id=p_actor for update;
  select * into d from private.frontend_cipc_reviews where check_id=x.id for update;
  select * into c from private.evidence_cases where id=x.id;
  if e.artifact_id is null or e.reviewed_version<>x.updated_at or not exists(
    select 1 from auth.sessions s join private.current_account_access a on a.id=s.user_id where s.id=p_session and s.user_id=p_actor
      and (s.not_after is null or s.not_after>now_at) and (e.source='owner_upload' or s.aal='aal2'))
    then raise exception 'current CIPC upload scope required' using errcode='PT409';end if;
  if e.source='admin_copy' and (c.claimed_by is distinct from p_actor or c.claim_generation::text<>e.claim_generation
    or c.claim_nonce is distinct from e.claim_nonce or c.claim_expires_at<=now_at
    or not exists(select 1 from private.staff_roles r join private.staff_capabilities a on a.role=r.role and a.capability='evidence:view'
      where r.user_id=p_actor and r.revoked_at is null)
    or not exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.factor_type='totp' and f.status='verified'))
    then raise exception 'current official copy claim required' using errcode='42501';end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=e.artifact_id and a.case_id=x.id and a.owner_id=x.owner_id
      and a.state='clean' and a.purpose='registration' and a.content_sha256=e.content_digest)
    then raise exception 'stored CIPC PDF receipt required' using errcode='PT409';end if;
  if e.source='admin_copy' and (p_summary->>'registrationNumber' is null or p_summary->>'registeredName' is null
    or p_summary->>'docType' is null or p_summary->>'docType'='unknown')
    then raise exception 'readable official CIPC disclosure required' using errcode='22023';end if;
  select f.identity_hmac,coalesce(nullif(btrim(p.value->>'role'),''),'Director') into match_fingerprint,match_position
    from jsonb_array_elements(p_directors) p(value) join private.accepted_identity_facts f on f.owner_id=x.owner_id
    and f.identity_hmac=p.value->>'fingerprint' and f.revoked_at is null
    where internal.frontend_business_identity_reviewed(x.owner_id) limit 1;
  receipt:=p_summary||jsonb_build_object('directors',coalesce((select jsonb_agg(jsonb_build_object(
    'name',internal.privacy_text(p.value->>'name',1,250),'role',left(p.value->>'role',120),
    'hasSaId',p.value->>'fingerprint' is not null,'isOwner',coalesce(p.value->>'fingerprint'=match_fingerprint,false))
    order by p.n) from jsonb_array_elements(p_directors) with ordinality p(value,n)),'[]'::jsonb));
  update private.frontend_cipc_documents set summary=receipt,recorded_at=now_at,owner_match_fingerprint=match_fingerprint,
    owner_match_position=left(match_position,120) where artifact_id=e.artifact_id;
  if e.source='admin_copy' then update private.frontend_cipc_reviews set official_file=e.artifact_id where check_id=x.id;
  else
    update private.frontend_cipc_reviews set owner_file=e.artifact_id,official_file=null,office_override=null,submitted_at=coalesce(submitted_at,now_at) where check_id=x.id;
  end if;
  update private.frontend_business_checks set status='pending',updated_at=now_at where id=x.id;
  return jsonb_build_object('caseId',x.id,'status','pending','updatedAt',now_at);
end$$;
create function api.record_frontend_cipc_parse(p_actor uuid,p_session uuid,p_artifact uuid,p_summary jsonb,p_directors jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.record_frontend_cipc_parse(p_actor,p_session,p_artifact,p_summary,p_directors)$$;

create function internal.get_frontend_cipc_preview_context(p_owner uuid,p_session uuid,p_business uuid,p_fingerprints text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if p_fingerprints is null or cardinality(p_fingerprints)>100
    or exists(select 1 from unnest(p_fingerprints) f where f is null or f !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$')
    then raise exception 'bounded document fingerprints required' using errcode='22023';end if;
  if not exists(select 1 from auth.sessions s join private.current_account_access a on a.id=s.user_id
      where s.id=p_session and s.user_id=p_owner and (s.not_after is null or s.not_after>clock_timestamp()))
    or not internal.frontend_business_identity_reviewed(p_owner)
    then raise exception 'reviewed business owner identity required' using errcode='42501';end if;
  select jsonb_build_object('profile_has_address',nullif(btrim(f.data->>'location_address'),'') is not null,
    'director_index',(select (d.n-1)::integer from unnest(p_fingerprints) with ordinality d(value,n)
      join private.accepted_identity_facts i on i.owner_id=p_owner and i.identity_hmac=d.value and i.revoked_at is null
      order by d.n limit 1)) into result
    from private.posts p left join private.post_presentations f on f.post_id=p.id
    where p.id=p_business and p.owner_id=p_owner and p.kind='business' and p.edit_of is null;
  if result is null then raise exception 'business unavailable' using errcode='PT404';end if;
  return result;
end$$;
create function api.get_frontend_cipc_preview_context(p_owner uuid,p_session uuid,p_business uuid,p_fingerprints text[])
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_cipc_preview_context(p_owner,p_session,p_business,p_fingerprints)$$;

create view private.frontend_cipc_latest_result with(security_invoker=true) as
  select distinct on(x.business_id) x.id,x.business_id,x.owner_id,x.kind,x.status,x.decided_at,x.expires_at,x.revoked_at,
    d.registration_number,d.registered_name,d.route,d.accepted_role,d.position_title,d.registered_office,d.display_full_office,d.linked_business_id
  from private.frontend_business_checks x join private.frontend_cipc_reviews d on d.check_id=x.id
  join private.posts p on p.id=x.business_id and p.owner_id=x.owner_id and p.kind='business'
  where x.kind in('cipc','cipc_link') and (x.status='approved' or x.revoked_at is not null)
  order by x.business_id,x.decided_at desc,x.id desc;
revoke all on private.frontend_cipc_latest_result from public,anon,authenticated,service_role;

create view private.frontend_current_cipc_stickers with(security_invoker=true) as
  select x.id,x.business_id,x.owner_id,x.kind,x.registration_number,
    coalesce(root.registered_name,x.registered_name) registered_name,
    coalesce(root.accepted_role,x.accepted_role) accepted_role,
    coalesce(root.position_title,x.position_title) position_title,
    coalesce(root.registered_office,x.registered_office) registered_office,x.display_full_office,
    x.decided_at,coalesce(root.expires_at,x.expires_at) expires_at,x.linked_business_id
  from private.frontend_cipc_latest_result x
  left join private.frontend_cipc_latest_result root on root.business_id=x.linked_business_id and root.owner_id=x.owner_id
    and root.kind='cipc' and root.status='approved' and root.registration_number=x.registration_number and root.expires_at>statement_timestamp()
  where x.status='approved' and internal.frontend_business_identity_reviewed(x.owner_id)
    and exists(select 1 from private.current_account_access a where a.id=x.owner_id)
    and ((x.kind='cipc' and x.expires_at>statement_timestamp()) or (x.kind='cipc_link' and root.id is not null));
revoke all on private.frontend_current_cipc_stickers from public,anon,authenticated,service_role;

create table private.frontend_cipc_exceptions(
  check_id uuid primary key references private.frontend_cipc_reviews(check_id) on delete cascade,
  official_file uuid not null references private.evidence_artifacts(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  reason text not null check(length(reason) between 10 and 1000),
  proposed_at timestamptz not null default clock_timestamp(),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  check(confirmed_by is null or confirmed_by<>proposed_by)
);
create index frontend_cipc_exception_file_idx on private.frontend_cipc_exceptions(official_file);
create index frontend_cipc_exception_proposer_idx on private.frontend_cipc_exceptions(proposed_by);
create index frontend_cipc_exception_confirmer_idx on private.frontend_cipc_exceptions(confirmed_by);
alter table private.frontend_cipc_exceptions enable row level security;
revoke all on private.frontend_cipc_exceptions from public,anon,authenticated,service_role;

-- For disclosures which omit IDs, require two reviewers and an unambiguous
-- match on the already verified legal name. Registry status is never waived.
create function internal.frontend_cipc_legal_name_match(p_owner uuid,p_copy jsonb)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists(select 1 from private.profiles p where p.account_id=p_owner and p.legal_first_name is not null
    and p.legal_last_name is not null and (select count(*) from jsonb_array_elements(coalesce(p_copy->'directors','[]'::jsonb)) j
      where regexp_replace(lower(j->>'name'),'[^[:alnum:]]','','g')=
        regexp_replace(lower(concat_ws(' ',p.legal_first_name,p.legal_last_name)),'[^[:alnum:]]','','g'))=1);
$$;
revoke all on function internal.frontend_cipc_legal_name_match(uuid,jsonb) from public,anon,authenticated,service_role;

create function internal.request_frontend_cipc_recheck(p_business uuid,p_source uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();prior private.frontend_cipc_latest_result;source private.frontend_current_cipc_stickers;
  case_id uuid;kind text;registration text;review_route text;parent uuid;root uuid;
begin
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  if not internal.frontend_business_identity_reviewed(actor) then raise exception 'reviewed owner identity required' using errcode='42501';end if;
  perform 1 from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business' and p.edit_of is null
    and p.status not in('archived','sold') for update;
  if not found then raise exception 'business unavailable' using errcode='PT404';end if;
  if exists(select 1 from private.frontend_business_checks x where x.business_id=p_business and x.kind in('cipc','cipc_link')
    and x.status in('pending','info_requested')) then raise exception 'this business already has a CIPC check in review' using errcode='PT409';end if;
  if p_source is null then
    select * into prior from private.frontend_cipc_latest_result where business_id=p_business and owner_id=actor;
    if not found or prior.kind<>'cipc' or prior.status<>'approved' then raise exception 'no independent CIPC sticker to renew' using errcode='PT409';end if;
    if prior.expires_at>clock_timestamp()+interval '60 days' then raise exception 'renewal opens 60 days before expiry' using errcode='PT409';end if;
    kind:='cipc';registration:=prior.registration_number;review_route:=prior.route;parent:=prior.id;
  else
    if p_source=p_business then raise exception 'choose another verified profile' using errcode='22023';end if;
    select * into source from private.frontend_current_cipc_stickers where business_id=p_source and owner_id=actor;
    if not found then raise exception 'choose a current CIPC verified profile on your account' using errcode='PT409';end if;
    root:=coalesce(source.linked_business_id,source.business_id);
    if root=p_business then raise exception 'choose an independent source profile' using errcode='22023';end if;
    kind:='cipc_link';registration:=source.registration_number;review_route:='director';parent:=source.id;
  end if;
  insert into private.evidence_cases(subject_id,kind) values(actor,'business') returning id into case_id;
  insert into private.frontend_business_checks(id,business_id,owner_id,kind) values(case_id,p_business,actor,kind);
  insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at,prior_check,linked_business_id,renewal,display_full_office)
    values(case_id,registration,review_route,clock_timestamp(),parent,root,p_source is null,coalesce(prior.display_full_office,false));
  perform internal.price_draft_actor();return jsonb_build_object('caseId',case_id,'status','pending');
end$$;
create function api.request_frontend_cipc_recheck(p_business uuid,p_source uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.request_frontend_cipc_recheck(p_business,p_source)$$;

create function internal.apply_frontend_registered_office(p_business uuid,p_owner uuid,p_office jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare target_city text;target_province text;city_label text;street_address text;
begin
  if p_office is null or p_office->>'city' is null or p_office->>'province' is null then return;end if;
  select c.id,c.province_id,c.label into target_city,target_province,city_label
    from private.cities c join private.provinces p on p.id=c.province_id
    where lower(c.label)=lower(p_office->>'city') and lower(p.label)=lower(p_office->>'province') order by c.id limit 1;
  if target_city is null then return;end if;
  select concat_ws(', ',nullif(string_agg(x.value,', ' order by x.n),''),nullif(p_office->>'suburb',''),nullif(p_office->>'postalCode',''))
    into street_address from jsonb_array_elements_text(coalesce(p_office->'streetLines','[]'::jsonb)) with ordinality x(value,n);
  update private.posts set province_id=target_province,city_id=target_city,
    locality_label=city_label,revision=revision+1,content_updated_at=clock_timestamp()
    where id=p_business and owner_id=p_owner and kind='business' and revision<2147483647;
  if not found then raise exception 'business location changed' using errcode='PT409';end if;
  if length(street_address) between 1 and 500 then
    insert into private.post_presentations(post_id,data) values(p_business,jsonb_build_object('location_address',street_address))
      on conflict(post_id) do update set data=private.post_presentations.data||excluded.data;
  end if;
  perform internal.write_post_projection(p_business);
end$$;
revoke all on function internal.apply_frontend_registered_office(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function internal.decide_frontend_cipc(p_case uuid,p_expected timestamptz,p_action text,p_generation text,p_nonce uuid,p_note text default null,p_reason text default null,p_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('verification:decide_routine');x private.frontend_business_checks;c private.evidence_cases;
  d private.frontend_cipc_reviews;doc private.frontend_cipc_documents;root private.frontend_current_cipc_stickers;exception_row private.frontend_cipc_exceptions;
  now_at timestamptz;new_status text;note_text text;name text;role_text text;position_text text;office jsonb;expiry timestamptz;
begin
  if p_action is null or p_action not in('approve','reject','request_info','propose_exception','confirm_exception','withdraw_exception')
    or (p_reason is not null and p_reason !~ '^[a-z0-9_]{1,80}$')
    then raise exception 'valid CIPC decision required' using errcode='22023';end if;
  if nullif(btrim(p_note),'') is not null then note_text:=internal.privacy_text(p_note,1,1000);end if;
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('verification:decide_routine');now_at:=clock_timestamp();
  if actor=x.owner_id then raise exception 'independent reviewer required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected or x.status<>'pending' then raise exception 'represented CIPC case changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  select * into d from private.frontend_cipc_reviews where check_id=x.id for update;
  if d.submitted_at is null then raise exception 'owner intake is not yet confirmed' using errcode='PT409';end if;
  if p_action='withdraw_exception' then
    select * into exception_row from private.frontend_cipc_exceptions where check_id=x.id for update;
    if not found or exception_row.confirmed_at is not null then raise exception 'no current exception proposal' using errcode='PT409';end if;
    if exception_row.proposed_by<>actor then perform internal.staff_actor('decision:approve');end if;
    delete from private.frontend_cipc_exceptions where check_id=x.id;
    update private.frontend_business_checks set updated_at=now_at where id=x.id;
    update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
    return jsonb_build_object('caseId',x.id,'status','pending');
  end if;
  if p_action='request_info' then
    note_text:=internal.privacy_text(p_note,1,1000);
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',note_text);
    update private.frontend_business_checks set status='info_requested',updated_at=now_at where id=x.id;
    update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
    perform internal.staff_actor('verification:decide_routine');return jsonb_build_object('caseId',x.id,'status','info_requested');
  end if;
  if p_action in('approve','propose_exception','confirm_exception') then
    if p_action='approve' and x.kind<>'cipc_link' and p_confirmed is distinct from true
      then raise exception 'confirm the official review findings' using errcode='22023';end if;
    if p_action<>'approve' and (x.kind<>'cipc' or d.route<>'director')
      then raise exception 'director name exception is unavailable for this case' using errcode='PT409';end if;
    perform pg_advisory_xact_lock(hashtextextended(d.registration_number,6509));
    if not internal.frontend_business_identity_reviewed(x.owner_id) or not exists(select 1 from private.current_account_access a where a.id=x.owner_id)
      then raise exception 'current reviewed owner required' using errcode='PT409';end if;
    if exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id)
      then raise exception 'another owner already has this registration' using errcode='PT409';end if;
    if x.kind='cipc_link' then
      select * into root from private.frontend_current_cipc_stickers s where s.business_id=d.linked_business_id and s.owner_id=x.owner_id
        and s.registration_number=d.registration_number and s.kind='cipc';
      if not found then raise exception 'source CIPC sticker changed or expired' using errcode='PT409';end if;
      name:=root.registered_name;role_text:=root.accepted_role;position_text:=root.position_title;office:=root.registered_office;expiry:=root.expires_at;
    else
      select e.* into doc from private.frontend_cipc_documents e join private.evidence_artifacts a on a.id=e.artifact_id
        where e.artifact_id=d.official_file and e.check_id=x.id and e.source='admin_copy' and e.actor_id<>x.owner_id
          and e.recorded_at is not null and a.state='clean' and a.content_sha256=e.content_digest
          and (a.retain_until is null or a.retain_until>now_at);
      if not found or doc.summary->>'registrationNumber' is distinct from d.registration_number
        or lower(btrim(doc.summary->>'enterpriseStatus')) is distinct from 'in business'
        then raise exception 'a matching current official CIPC copy showing In Business is required' using errcode='PT409';end if;
      name:=internal.privacy_text(doc.summary->>'registeredName',2,250);
      office:=coalesce(d.office_override,nullif(doc.summary->'registeredOffice','null'::jsonb));
      if p_action='propose_exception' then
        note_text:=internal.privacy_text(p_note,10,1000);
        if not internal.frontend_cipc_legal_name_match(x.owner_id,doc.summary)
          then raise exception 'the official copy must uniquely match the verified owner name' using errcode='PT409';end if;
        if exists(select 1 from private.frontend_cipc_exceptions e where e.check_id=x.id and e.official_file=doc.artifact_id)
          then raise exception 'an exception is already waiting for review' using errcode='PT409';end if;
        insert into private.frontend_cipc_exceptions(check_id,official_file,proposed_by,reason)
          values(x.id,doc.artifact_id,actor,note_text)
          on conflict(check_id) do update set official_file=excluded.official_file,proposed_by=excluded.proposed_by,
            reason=excluded.reason,proposed_at=now_at,confirmed_by=null,confirmed_at=null;
        update private.frontend_business_checks set updated_at=now_at where id=x.id;
        update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
        perform internal.staff_actor('verification:decide_routine');return jsonb_build_object('caseId',x.id,'status','pending');
      end if;
      if p_action='confirm_exception' then
        perform internal.staff_actor('decision:approve');
        select * into exception_row from private.frontend_cipc_exceptions where check_id=x.id and official_file=doc.artifact_id and confirmed_at is null for update;
        if not found or not internal.frontend_cipc_legal_name_match(x.owner_id,doc.summary)
          then raise exception 'represented exception or evidence changed' using errcode='PT409';end if;
        if exception_row.proposed_by=actor then raise exception 'a different senior reviewer must confirm' using errcode='42501';end if;
        update private.frontend_cipc_exceptions set confirmed_by=actor,confirmed_at=now_at where check_id=x.id;
      end if;
      if d.route='representative' then
        if d.representative_verified_at is null or not d.domain_confirmed or not d.callback_confirmed
          then raise exception 'work email and independent callback required' using errcode='PT409';end if;
        role_text:='representative';position_text:=d.representative_position;
      else
        if p_action<>'confirm_exception' and (doc.owner_match_fingerprint is null or not exists(select 1 from private.accepted_identity_facts f
          where f.owner_id=x.owner_id and f.identity_hmac=doc.owner_match_fingerprint and f.revoked_at is null)
          ) then raise exception 'reviewed owner does not match a director on the official copy' using errcode='PT409';end if;
        role_text:=case when doc.owner_match_position ilike '%member%' then 'member' else 'director' end;
        position_text:=doc.owner_match_position;
      end if;
      expiry:=now_at+interval '365 days';
    end if;
    update private.frontend_cipc_reviews set registered_name=name,accepted_role=role_text,position_title=position_text,registered_office=office where check_id=x.id;
    if x.kind='cipc' and d.use_registered_office then perform internal.apply_frontend_registered_office(x.business_id,x.owner_id,office);end if;
    new_status:='approved';
  else new_status:='rejected';end if;
  update private.frontend_business_checks set status=new_status,review_note=note_text,reviewed_by=actor,reason_code=p_reason,
    decided_at=now_at,updated_at=now_at,expires_at=expiry where id=x.id;
  update private.evidence_cases set status='decided',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),now_at+interval '30 days')
    where case_id=x.id and state='clean';
  perform internal.staff_actor('verification:decide_routine');
  return jsonb_build_object('caseId',x.id,'status',new_status);
end$$;
create function api.decide_frontend_cipc(p_case uuid,p_expected timestamptz,p_action text,p_generation text,p_nonce uuid,p_note text default null,p_reason text default null,p_confirmed boolean default false)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.decide_frontend_cipc(p_case,p_expected,p_action,p_generation,p_nonce,p_note,p_reason,p_confirmed)$$;

create function internal.revoke_frontend_cipc(p_case uuid,p_expected timestamptz,p_note text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:approve');subject uuid;x private.frontend_business_checks;now_at timestamptz;note_text text;
begin
  note_text:=internal.privacy_text(p_note,5,1000);
  if p_reason is null or p_reason !~ '^[a-z0-9_]{1,80}$' then raise exception 'a reason for revocation is required' using errcode='22023';end if;
  select owner_id into subject from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if subject is null then raise exception 'CIPC case unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);actor:=internal.staff_actor('decision:approve');
  if actor=subject then raise exception 'independent revocation required' using errcode='42501';end if;
  select * into x from private.frontend_business_checks where id=p_case for update;
  if not found or x.status<>'approved' or x.updated_at is distinct from p_expected then raise exception 'represented CIPC case changed' using errcode='PT409';end if;
  now_at:=clock_timestamp();
  update private.frontend_business_checks set status='withdrawn',expires_at=null,revoked_at=now_at,review_note=note_text,reason_code=p_reason,updated_at=now_at where id=x.id;
  insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',note_text);
  perform internal.staff_actor('decision:approve');return jsonb_build_object('caseId',x.id,'status','withdrawn');
end$$;
create function api.revoke_frontend_cipc(p_case uuid,p_expected timestamptz,p_note text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.revoke_frontend_cipc(p_case,p_expected,p_note,p_reason)$$;

create table private.frontend_cipc_email_codes(
  check_id uuid primary key references private.frontend_cipc_reviews(check_id) on delete cascade,
  challenge uuid not null unique default gen_random_uuid(),
  digest text not null check(digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  started_at timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 5),
  check(expires_at>started_at)
);
alter table private.frontend_cipc_email_codes enable row level security;
revoke all on private.frontend_cipc_email_codes from public,anon,authenticated,service_role;

create function internal.frontend_cipc_owner_session(p_actor uuid,p_session uuid)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select exists(select 1 from auth.sessions s join private.current_account_access a on a.id=s.user_id
    where s.id=p_session and s.user_id=p_actor and (s.not_after is null or s.not_after>clock_timestamp()));
$$;
revoke all on function internal.frontend_cipc_owner_session(uuid,uuid) from public,anon,authenticated,service_role;

create function internal.start_frontend_cipc_email(p_owner uuid,p_session uuid,p_business uuid,p_case uuid,p_email text,p_position text,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.frontend_business_checks;email text:=lower(btrim(p_email));pos text;challenge uuid;now_at timestamptz;
begin
  if not internal.frontend_cipc_owner_session(p_owner,p_session) then raise exception 'live owner session required' using errcode='42501';end if;
  pos:=internal.privacy_text(p_position,2,40);
  if email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'valid work email required' using errcode='22023';end if;
  x:=internal.lock_frontend_cipc_case(p_case);now_at:=clock_timestamp();
  if x.owner_id<>p_owner or x.business_id<>p_business or not internal.frontend_cipc_owner_session(p_owner,p_session)
    or not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=x.id and d.route='representative' and d.submitted_at is not null)
    then raise exception 'open representative case unavailable' using errcode='PT404';end if;
  if exists(select 1 from private.frontend_cipc_email_codes c where c.check_id=x.id and c.started_at>now_at-interval '1 minute')
    then raise exception 'wait before requesting another code' using errcode='PT429';end if;
  insert into private.frontend_cipc_email_codes(check_id,digest,expires_at,started_at)
    values(x.id,p_digest,now_at+interval '15 minutes',now_at)
    on conflict(check_id) do update set digest=excluded.digest,expires_at=excluded.expires_at,started_at=excluded.started_at,
      challenge=gen_random_uuid(),sent_at=null,attempts=0 returning frontend_cipc_email_codes.challenge into challenge;
  update private.frontend_cipc_reviews set representative_email=email,representative_position=pos,representative_verified_at=null,
    domain_confirmed=false,callback_confirmed=false,callback_record=null where check_id=x.id;
  update private.frontend_business_checks set updated_at=now_at where id=x.id;
  return jsonb_build_object('challenge',challenge);
end$$;
create function api.start_frontend_cipc_email(p_owner uuid,p_session uuid,p_business uuid,p_case uuid,p_email text,p_position text,p_digest text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.start_frontend_cipc_email(p_owner,p_session,p_business,p_case,p_email,p_position,p_digest)$$;

create function internal.mark_frontend_cipc_email_sent(p_owner uuid,p_session uuid,p_case uuid,p_challenge uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare x private.frontend_business_checks;
begin
  if not internal.frontend_cipc_owner_session(p_owner,p_session) then raise exception 'live owner session required' using errcode='42501';end if;
  x:=internal.lock_frontend_cipc_case(p_case);
  if x.owner_id<>p_owner then raise exception 'open representative case unavailable' using errcode='PT404';end if;
  update private.frontend_cipc_email_codes c set sent_at=coalesce(c.sent_at,clock_timestamp())
    where c.check_id=x.id and c.challenge=p_challenge and c.expires_at>clock_timestamp();
  return found;
end$$;
create function api.mark_frontend_cipc_email_sent(p_owner uuid,p_session uuid,p_case uuid,p_challenge uuid)
returns boolean language sql security invoker set search_path=pg_catalog as $$select internal.mark_frontend_cipc_email_sent(p_owner,p_session,p_case,p_challenge)$$;

create function internal.verify_frontend_cipc_email(p_owner uuid,p_session uuid,p_business uuid,p_case uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare x private.frontend_business_checks;c private.frontend_cipc_email_codes;now_at timestamptz;
begin
  if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'valid code digest required' using errcode='22023';end if;
  if not internal.frontend_cipc_owner_session(p_owner,p_session) then raise exception 'live owner session required' using errcode='42501';end if;
  x:=internal.lock_frontend_cipc_case(p_case);now_at:=clock_timestamp();
  if x.owner_id<>p_owner or x.business_id<>p_business or not internal.frontend_cipc_owner_session(p_owner,p_session)
    then raise exception 'open representative case unavailable' using errcode='PT404';end if;
  select * into c from private.frontend_cipc_email_codes where check_id=x.id for update;
  if not found or c.sent_at is null or c.expires_at<=now_at or c.attempts>=5
    then return jsonb_build_object('verified',false,'remaining',0);end if;
  if c.digest<>p_digest then
    update private.frontend_cipc_email_codes set attempts=attempts+1 where check_id=x.id;
    return jsonb_build_object('verified',false,'remaining',4-c.attempts);
  end if;
  update private.frontend_cipc_reviews set representative_verified_at=now_at where check_id=x.id and route='representative';
  if not found then raise exception 'representative route changed' using errcode='PT409';end if;
  delete from private.frontend_cipc_email_codes where check_id=x.id;
  update private.frontend_business_checks set updated_at=now_at where id=x.id;
  return jsonb_build_object('verified',true,'remaining',0);
end$$;
create function api.verify_frontend_cipc_email(p_owner uuid,p_session uuid,p_business uuid,p_case uuid,p_digest text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.verify_frontend_cipc_email(p_owner,p_session,p_business,p_case,p_digest)$$;

create function internal.record_frontend_cipc_callback(p_case uuid,p_expected timestamptz,p_generation text,p_nonce uuid,p_domain boolean,p_callback jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:view');x private.frontend_business_checks;c private.evidence_cases;now_at timestamptz;record_body jsonb;position text;
begin
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('evidence:view');now_at:=clock_timestamp();
  if actor=x.owner_id or p_domain is null then raise exception 'independent callback confirmation required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected then raise exception 'represented CIPC case changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if p_callback is null or jsonb_typeof(p_callback)<>'object' or octet_length(p_callback::text)>10000
    or exists(select 1 from jsonb_object_keys(p_callback) k where k not in('numberSource','spokeTo','confirmedPosition','confirmed','notes'))
    or jsonb_typeof(p_callback->'confirmed') is distinct from 'boolean'
    then raise exception 'valid callback record required' using errcode='22023';end if;
  position:=internal.privacy_text(p_callback->>'confirmedPosition',2,40);
  record_body:=jsonb_build_object('numberSource',internal.privacy_text(p_callback->>'numberSource',5,200),
    'spokeTo',internal.privacy_text(p_callback->>'spokeTo',2,120),'confirmedPosition',position,
    'confirmed',p_callback->'confirmed','notes',case when nullif(p_callback->>'notes','') is not null then internal.privacy_text(p_callback->>'notes',1,1000) end,
    'by',actor,'at',now_at);
  update private.frontend_cipc_reviews set domain_confirmed=p_domain,representative_position=position,
    callback_confirmed=(p_callback->>'confirmed')::boolean,callback_record=record_body
    where check_id=x.id and route='representative' and representative_verified_at is not null;
  if not found then raise exception 'the representative must verify their work email first' using errcode='PT409';end if;
  update private.frontend_business_checks set updated_at=now_at where id=x.id;
  perform internal.staff_actor('evidence:view');return jsonb_build_object('ok',true,'confirmed',p_domain and (p_callback->>'confirmed')::boolean);
end$$;
create function api.record_frontend_cipc_callback(p_case uuid,p_expected timestamptz,p_generation text,p_nonce uuid,p_domain boolean,p_callback jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.record_frontend_cipc_callback(p_case,p_expected,p_generation,p_nonce,p_domain,p_callback)$$;

create function internal.switch_frontend_cipc_representative(p_business uuid,p_case uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();x private.frontend_business_checks;
begin
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.price_draft_actor();
  if actor<>x.owner_id or x.business_id<>p_business or x.kind<>'cipc' then raise exception 'owner CIPC case unavailable' using errcode='PT404';end if;
  update private.frontend_cipc_reviews set route='representative' where check_id=x.id and route='director' and submitted_at is not null;
  if not found then raise exception 'no open director request to switch' using errcode='PT409';end if;
  update private.frontend_business_checks set status='pending',updated_at=clock_timestamp() where id=x.id;
  perform internal.price_draft_actor();return jsonb_build_object('ok',true);
end$$;
create function api.switch_frontend_cipc_representative(p_business uuid,p_case uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.switch_frontend_cipc_representative(p_business,p_case)$$;

create function internal.set_frontend_cipc_office_visibility(p_business uuid,p_show boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();sticker uuid;
begin
  if p_show is null then raise exception 'choose whether to show the full office' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  select id into sticker from private.frontend_current_cipc_stickers s where s.business_id=p_business and s.owner_id=actor;
  if sticker is null then raise exception 'current verified registration required' using errcode='PT409';end if;
  update private.frontend_cipc_reviews set display_full_office=p_show where check_id=sticker;
  perform internal.price_draft_actor();return jsonb_build_object('showFull',p_show);
end$$;
create function api.set_frontend_cipc_office_visibility(p_business uuid,p_show boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.set_frontend_cipc_office_visibility(p_business,p_show)$$;

create function internal.correct_frontend_cipc_office(p_case uuid,p_expected timestamptz,p_generation text,p_nonce uuid,p_office jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:view');x private.frontend_business_checks;c private.evidence_cases;
  province text;city text;verified_city text;street jsonb;
begin
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('evidence:view');
  if actor=x.owner_id or x.kind<>'cipc' then raise exception 'independent official CIPC review required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected then raise exception 'represented CIPC case changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if p_office is null or jsonb_typeof(p_office)<>'object' or octet_length(p_office::text)>6000
    or exists(select 1 from jsonb_object_keys(p_office) k where k not in('streetLines','suburb','city','province','postalCode'))
    or jsonb_typeof(p_office->'streetLines') is distinct from 'array' or jsonb_array_length(p_office->'streetLines')>3
    or (p_office->>'postalCode' is not null and p_office->>'postalCode' !~ '^[0-9]{4}$')
    then raise exception 'valid registered office required' using errcode='22023';end if;
  select p.label into province from private.provinces p where lower(p.label)=lower(p_office->>'province');
  if province is null then raise exception 'choose a recognised South African province' using errcode='22023';end if;
  city:=internal.privacy_text(p_office->>'city',1,80);
  select c2.label into verified_city from private.cities c2 join private.provinces p on p.id=c2.province_id
    where p.label=province and lower(c2.label)=lower(city) order by c2.id limit 1;
  select coalesce(jsonb_agg(internal.privacy_text(t.value,1,120) order by t.n),'[]'::jsonb) into street
    from jsonb_array_elements_text(p_office->'streetLines') with ordinality t(value,n);
  update private.frontend_cipc_reviews set office_override=jsonb_build_object('streetLines',street,'city',coalesce(verified_city,city),
    'province',province,'postalCode',p_office->>'postalCode','cityKnown',verified_city is not null,
    'suburb',case when nullif(p_office->>'suburb','') is not null then internal.privacy_text(p_office->>'suburb',1,80) end)
    where check_id=x.id;
  update private.frontend_business_checks set updated_at=clock_timestamp() where id=x.id;
  perform internal.staff_actor('evidence:view');return jsonb_build_object('ok',true);
end$$;
create function api.correct_frontend_cipc_office(p_case uuid,p_expected timestamptz,p_generation text,p_nonce uuid,p_office jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.correct_frontend_cipc_office(p_case,p_expected,p_generation,p_nonce,p_office)$$;

create function internal.get_my_frontend_business_review_state(p_business uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();base jsonb;sticker jsonb;cases jsonb;links jsonb;
begin
  base:=internal.get_my_frontend_business_checks(p_business);
  select jsonb_build_object('verifiedAt',s.decided_at,'expiresAt',s.expires_at,'registrationNumber',s.registration_number,
    'registeredName',s.registered_name,'role',s.accepted_role,'position',s.position_title,'showFullRegisteredOffice',s.display_full_office,
    'registeredOffice',s.registered_office) into sticker from private.frontend_current_cipc_stickers s where s.business_id=p_business and s.owner_id=actor;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'status',case when x.revoked_at is not null then 'revoked' else x.status end,
    'route',d.route,'registrationNumber',d.registration_number,'reasonCode',x.reason_code,'note',x.review_note,
    'createdAt',x.created_at,'decidedAt',x.decided_at,'expiresAt',x.expires_at,'seenMethod',x.seen_method,'seenScheduledFor',x.scheduled_for,
    'representative',case when d.route='representative' then jsonb_build_object('email',d.representative_email,'position',d.representative_position,
      'emailVerified',d.representative_verified_at is not null,'codeSent',exists(select 1 from private.frontend_cipc_email_codes code where code.check_id=x.id and code.sent_at is not null)) end,
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'from',case m.author_role when 'owner' then 'You' else 'VerifyMzansi team' end,
      'mine',m.author_role='owner','body',m.body,'createdAt',m.created_at) order by m.created_at,m.id)
      from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb))
    order by x.created_at desc,x.id desc),'[]'::jsonb) into cases
    from (select b.* from private.frontend_business_checks b left join private.frontend_cipc_reviews d0 on d0.check_id=b.id
      where b.business_id=p_business and b.owner_id=actor and (b.kind='seen' or d0.submitted_at is not null)
      order by b.created_at desc,b.id desc limit 20)x left join private.frontend_cipc_reviews d on d.check_id=x.id;
  select coalesce(jsonb_agg(jsonb_build_object('businessId',x.business_id,'businessName',x.title,'registrationNumber',x.registration_number,'registeredName',x.registered_name)
    order by x.title,x.business_id),'[]'::jsonb) into links from (
      select s.business_id,coalesce(p.title,'Business') title,s.registration_number,s.registered_name
      from private.frontend_current_cipc_stickers s join private.posts p on p.id=s.business_id
      where s.owner_id=actor and s.business_id<>p_business order by p.title,s.business_id limit 100)x;
  perform internal.price_draft_actor();
  return jsonb_set(base,'{stickers,cipc}',coalesce(sticker,'null'::jsonb))||jsonb_build_object('cases',cases,'linkable',links);
end$$;
create function api.get_my_frontend_business_review_state(p_business uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_business_review_state(p_business)$$;

create function internal.get_public_frontend_business_cipc(p_post_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids)>100 or coalesce(array_ndims(p_post_ids),1)<>1
    then raise exception 'bounded represented businesses required' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('business_id',s.business_id,'verified_at',s.decided_at,'expires_at',s.expires_at,
    'registration_number',s.registration_number,'registered_name',s.registered_name,'role',s.accepted_role,'position',s.position_title,
    'office',case when s.registered_office is not null then
      jsonb_build_object('suburb',s.registered_office->>'suburb','city',s.registered_office->>'city','province',s.registered_office->>'province')||
      case when s.display_full_office then jsonb_build_object('streetLines',coalesce(s.registered_office->'streetLines','[]'::jsonb),
        'postalCode',s.registered_office->>'postalCode') else '{}'::jsonb end end)
    order by s.business_id),'[]'::jsonb) into result
  from private.frontend_current_cipc_stickers s join private.public_eligible_posts p on p.id=s.business_id where s.business_id=any(p_post_ids);
  return result;
end$$;
create function api.get_public_frontend_business_cipc(p_post_ids uuid[])
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select internal.get_public_frontend_business_cipc(p_post_ids)$$;
revoke all on function internal.get_public_frontend_business_cipc(uuid[]),api.get_public_frontend_business_cipc(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.get_public_frontend_business_cipc(uuid[]),api.get_public_frontend_business_cipc(uuid[]) to anon,authenticated;

create function internal.get_frontend_business_review_queue(p_tab text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');seen jsonb;result jsonb;
begin
  seen:=internal.get_frontend_seen_queue(p_tab);
  with rows as (
    select x.id,x.kind,x.status,x.business_id,x.created_at,x.updated_at,x.decided_at,d.route,d.registration_number,d.renewal,
      coalesce(p.title,'Business') business_name,coalesce(pr.display_name,'Member') owner_name,
      e.claimed_by=actor and e.claim_expires_at>clock_timestamp() mine,
      exists(select 1 from private.frontend_cipc_exceptions exc where exc.check_id=x.id and exc.official_file=d.official_file and exc.confirmed_at is null) exception_pending,
      exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id) conflict
    from private.frontend_business_checks x join private.frontend_cipc_reviews d on d.check_id=x.id and d.submitted_at is not null
    join private.posts p on p.id=x.business_id join private.evidence_cases e on e.id=x.id
    left join private.profiles pr on pr.account_id=x.owner_id where x.owner_id<>actor
  ), labelled as (
    select r.*,case when status not in('pending','info_requested') then 'decided'
      when status='info_requested' then 'waiting' when exception_pending then 'exceptions'
      when conflict then 'conflicts' when route='representative' then 'representatives'
      when renewal then 'renewals' else 'review' end tab from rows r
  ), merged as (
    select j.value item from jsonb_array_elements(seen->'rows') j
    union all
    select jsonb_build_object('id',x.id,'kind',x.kind,'route',x.route,'status',x.status,'businessId',x.business_id,
      'businessName',x.business_name,'ownerName',x.owner_name,'registrationNumber',x.registration_number,
      'red',case when x.conflict then 1 else 0 end,'amber',case when x.renewal then 1 else 0 end,
      'createdAt',x.created_at,'updatedAt',x.updated_at,'exceptionPending',x.exception_pending,'conflict',x.conflict,'renewal',x.renewal)
    from labelled x where x.tab=p_tab or (p_tab<>'decided' and x.tab<>'decided' and x.mine)
  )
  select jsonb_build_object('actor_id',actor,
    'counts',(select jsonb_object_agg(k,case when k='decided' then null else (seen->'counts'->>k)::bigint+(select count(*) from labelled where tab=k) end)
      from jsonb_object_keys(seen->'counts') k),
    'rows',coalesce((select jsonb_agg(r.item) from (select item from merged order by
      case when p_tab='decided' then -(extract(epoch from (item->>'updatedAt')::timestamptz)) else -(item->>'red')::integer end,
      (item->>'createdAt')::timestamptz,item->>'id' limit 200)r),'[]'::jsonb)) into result;
  perform internal.staff_actor('queue:view');return result;
end$$;
create function api.get_frontend_business_review_queue(p_tab text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_business_review_queue(p_tab)$$;

create function internal.get_frontend_cipc_case(p_case uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');x private.frontend_business_checks;c private.evidence_cases;
  d private.frontend_cipc_reviews;owner_doc private.frontend_cipc_documents;official_doc private.frontend_cipc_documents;
  root private.frontend_current_cipc_stickers;exception_row private.frontend_cipc_exceptions;permitted boolean;
  result jsonb;missing text[]:='{}';hard text[]:='{}';ids uuid[];role_text text;position_text text;company_name text;
begin
  select * into x from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if not found then return null;end if;
  perform internal.lock_verification_subject(x.owner_id);
  select * into x from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if not found then return null;end if;
  select * into d from private.frontend_cipc_reviews where check_id=x.id and submitted_at is not null;
  if not found then return null;end if;
  select * into c from private.evidence_cases where id=x.id;
  permitted:=actor<>x.owner_id and coalesce(actor=x.reviewed_by or (c.status='open' and c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false);
  if permitted then
    perform internal.staff_actor('evidence:view');
    select * into owner_doc from private.frontend_cipc_documents where artifact_id=d.owner_file;
    select * into official_doc from private.frontend_cipc_documents where artifact_id=d.official_file;
    select * into exception_row from private.frontend_cipc_exceptions where check_id=x.id and official_file=d.official_file;
    select coalesce(array_agg(e.artifact_id),'{}') into ids from private.frontend_cipc_documents e join private.evidence_artifacts a on a.id=e.artifact_id
      where e.check_id=x.id and e.recorded_at is not null and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp());
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,c.id,'routine_review',c.version,c.claim_generation,ids);
    if x.kind='cipc_link' then
      select * into root from private.frontend_current_cipc_stickers s where s.business_id=d.linked_business_id
        and s.owner_id=x.owner_id and s.registration_number=d.registration_number and s.kind='cipc';
      if not found then hard:=array_append(hard,'The source profile no longer holds a current CIPC sticker.');end if;
      company_name:=root.registered_name;role_text:=root.accepted_role;position_text:=root.position_title;
    else
      if official_doc.artifact_id is null or not (official_doc.artifact_id=any(ids)) then
        hard:=array_append(hard,'Attach the current copy you fetched from CIPC.');
      elsif official_doc.summary->>'registrationNumber' is distinct from d.registration_number then
        hard:=array_append(hard,'The official copy is for a different registration number.');
      elsif lower(btrim(official_doc.summary->>'enterpriseStatus')) is distinct from 'in business' then
        hard:=array_append(hard,'The official register must show the company as In Business.');
      end if;
      company_name:=official_doc.summary->>'registeredName';
      if d.route='representative' then
        if d.representative_verified_at is null or not d.domain_confirmed or not d.callback_confirmed then
          hard:=array_append(hard,'Confirm the representative by work email and independent callback.');
        end if;
        role_text:='representative';position_text:=d.representative_position;
      elsif official_doc.owner_match_fingerprint is null or not exists(select 1 from private.accepted_identity_facts f
        where f.owner_id=x.owner_id and f.identity_hmac=official_doc.owner_match_fingerprint and f.revoked_at is null) then
        if internal.frontend_cipc_legal_name_match(x.owner_id,official_doc.summary) then
          missing:=array_append(missing,'The official copy does not include a matching ID. A second reviewer must confirm the unique legal name.');
        else hard:=array_append(hard,'The current owner does not match a director on the official copy.');end if;
      else
        role_text:=case when official_doc.owner_match_position ilike '%member%' then 'member' else 'director' end;
        position_text:=official_doc.owner_match_position;
      end if;
    end if;
    if exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id)
      then hard:=array_append(hard,'Another owner already holds this registration.');end if;
    if not internal.frontend_business_identity_reviewed(x.owner_id) then hard:=array_append(hard,'The owner needs a current ID review.');end if;
  else hard:=array_append(hard,'Claim this case to inspect the private review details.');end if;
  missing:=hard||missing;
  select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'kind',x.kind,'route',d.route,'status',case when x.revoked_at is not null then 'revoked' else x.status end,
    'registrationNumber',d.registration_number,'createdAt',x.created_at,'updatedAt',x.updated_at,'decidedAt',x.decided_at,'expiresAt',x.expires_at,
    'reasonCode',x.reason_code,'reviewNote',case when permitted then x.review_note end,
    'business',jsonb_build_object('id',p.id,'business_name',p.title,'slug',s.slug,'status',p.status,'location_city',city.label,'location_province',prov.label),
    'owner',jsonb_build_object('displayName',pr.display_name,'legalName',case when permitted then nullif(concat_ws(' ',pr.legal_first_name,pr.legal_last_name),'') end,
      'idReviewed',internal.frontend_business_identity_reviewed(x.owner_id)),
    'parsed',owner_doc.summary,'official',official_doc.summary,
    'office',case when permitted then coalesce(d.office_override,d.registered_office,nullif(official_doc.summary->'registeredOffice','null'::jsonb),nullif(owner_doc.summary->'registeredOffice','null'::jsonb)) end,
    'representative',case when permitted and d.route='representative' then jsonb_build_object('email',d.representative_email,'position',d.representative_position,
      'emailVerifiedAt',d.representative_verified_at,'domainConfirmed',d.domain_confirmed,'callback',d.callback_record,
      'confirmed',d.representative_verified_at is not null and d.domain_confirmed and d.callback_confirmed) end,
    'exception',case when exception_row.check_id is not null then jsonb_build_object('proposedBy',exception_row.proposed_by,'confirmedBy',exception_row.confirmed_by,'reason',exception_row.reason) end,
    'evidence',jsonb_build_object('ready',cardinality(missing)=0,'missing',missing,'unwaivable',hard,'role',role_text,'position',position_text,'registeredName',company_name),
    'files',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind',e.source,'content_type','application/pdf',
      'size_bytes',a.size_bytes,'created_at',a.created_at,'quarantined',false,'purged_at',a.deleted_at) order by a.created_at,a.id)
      from private.evidence_artifacts a join private.frontend_cipc_documents e on e.artifact_id=a.id where a.id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
    'messages',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_id',m.author_id,
      'author_role',m.author_role,'body',m.body,'created_at',m.created_at,'attachment_file_id',case when m.attachment_file_id=any(ids) then m.attachment_file_id end)
      order by m.created_at,m.id) from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb) else '[]'::jsonb end,
    'accessLog',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('actor_id',a.staff_id,'action',a.purpose,'created_at',a.accessed_at) order by a.accessed_at desc)
      from (select * from private.evidence_access_log where case_id=x.id order by accessed_at desc limit 10)a),'[]'::jsonb) else '[]'::jsonb end)
  into result from private.posts p left join private.post_slugs s on s.post_id=p.id left join private.profiles pr on pr.account_id=x.owner_id
    left join private.cities city on city.id=p.city_id left join private.provinces prov on prov.id=p.province_id
    where p.id=x.business_id and p.owner_id=x.owner_id;
  perform internal.staff_actor('queue:view');return result;
end$$;
create function api.get_frontend_cipc_case(p_case uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_cipc_case(p_case)$$;

-- Registration PDFs share the same signed, audited file-serving path as
-- visit evidence. Unrecorded uploads remain outside the reviewer view.
create or replace view private.frontend_business_seen_files with(security_invoker=true) as
  select artifact_id,check_id,content_digest,mime,'visit_photo'::text kind from private.frontend_business_seen_photos
  union all select f.artifact_id,f.check_id,f.content_digest,f.mime,'message_attachment'::text from private.frontend_business_reply_files f
    join private.frontend_business_check_messages m on m.attachment_file_id=f.artifact_id and m.check_id=f.check_id
  union all select d.artifact_id,d.check_id,d.content_digest,'application/pdf'::text,d.source
    from private.frontend_cipc_documents d where d.recorded_at is not null;
revoke all on private.frontend_business_seen_files from public,anon,authenticated,service_role;
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.frontend_seen_file_object(uuid,uuid)'::regprocedure;
  if md5(body)<>'5a00950506ad54f9aafece2dc1b2393c' then raise exception 'business evidence reader drift';end if;
  changed:=replace(body,'a.purpose in(''business_visit_photo'',''business_reply_attachment'')',
    'a.purpose in(''business_visit_photo'',''business_reply_attachment'',''registration'')');
  if changed=body then raise exception 'registration PDF reader anchor missing';end if;
  execute format('create or replace function internal.frontend_seen_file_object(p_case uuid,p_artifact uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.send_frontend_seen_message(uuid,text,uuid,uuid)'::regprocedure;
  if md5(body)<>'68dc528f79f12aa423d08f746cc21a68' then raise exception 'business message authority drift';end if;
  changed:=replace(body,'where id=p_case and kind=''seen''',
    'where id=p_case and (kind=''seen'' or exists(select 1 from private.frontend_cipc_reviews d where d.check_id=p_case and d.submitted_at is not null))');
  changed:=replace(changed,'from private.frontend_business_reply_files f join private.evidence_artifacts a on a.id=f.artifact_id',
    'from (select artifact_id,check_id,content_digest from private.frontend_business_reply_files
      union all select d.artifact_id,d.check_id,d.content_digest from private.frontend_cipc_documents d
        join private.frontend_cipc_reviews r on r.check_id=d.check_id and r.owner_file=d.artifact_id
        where d.source=''owner_upload'' and d.recorded_at is not null)f join private.evidence_artifacts a on a.id=f.artifact_id');
  if changed=body or position('r.owner_file=d.artifact_id' in changed)=0 then raise exception 'registration message scope anchor missing';end if;
  execute format('create or replace function internal.send_frontend_seen_message(p_case uuid,p_body text,p_business uuid default null,p_artifact uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;

do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_frontend_staff_items(text,integer)'::regprocedure;
  if md5(body)<>'d8b4123365164cfdfa74d1af27d09a25' then raise exception 'business claim batch drift';end if;
  changed:=replace(body,'exists(select 1 from private.evidence_artifacts a where a.case_id=c.id and a.purpose=''registration'' and a.state=''clean'')',
    '(exists(select 1 from private.frontend_cipc_reviews d join private.frontend_business_checks x on x.id=d.check_id
      where d.check_id=c.id and d.submitted_at is not null and x.status=''pending'')
     or (not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=c.id)
       and exists(select 1 from private.evidence_artifacts a where a.case_id=c.id and a.purpose=''registration'' and a.state=''clean'')))');
  if changed=body then raise exception 'CIPC claim batch anchor missing';end if;
  execute format('create or replace function internal.claim_frontend_staff_items(p_queue text,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_evidence_case(uuid)'::regprocedure;
  if md5(body)<>'3df4e835df6129b75baa69471f26376b' then raise exception 'business claim subject drift';end if;
  changed:=replace(body,'  if c.subject_id = actor then',
    '  if c.kind=''business'' and exists(select 1 from private.frontend_cipc_reviews d join private.frontend_business_checks x on x.id=d.check_id
    where d.check_id=c.id and (d.submitted_at is null or x.status<>''pending'')) then
    raise exception ''CIPC case is not ready for a claim'' using errcode=''PT409'';end if;
  if c.subject_id = actor then');
  if changed=body then raise exception 'CIPC claim authority anchor missing';end if;
  execute format('create or replace function internal.claim_evidence_case(p_case_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;

do $$declare signature text;ns text;audience text;begin
  foreach signature in array array['reserve_frontend_cipc_document(uuid,text,text,boolean,text,uuid)','reserve_frontend_cipc_official(uuid,timestamptz,text,uuid,text)','record_frontend_cipc_parse(uuid,uuid,uuid,jsonb,jsonb)','get_frontend_cipc_preview_context(uuid,uuid,uuid,text[])','request_frontend_cipc_recheck(uuid,uuid)','decide_frontend_cipc(uuid,timestamptz,text,text,uuid,text,text,boolean)','revoke_frontend_cipc(uuid,timestamptz,text,text)','start_frontend_cipc_email(uuid,uuid,uuid,uuid,text,text,text)','mark_frontend_cipc_email_sent(uuid,uuid,uuid,uuid)','verify_frontend_cipc_email(uuid,uuid,uuid,uuid,text)','record_frontend_cipc_callback(uuid,timestamptz,text,uuid,boolean,jsonb)','switch_frontend_cipc_representative(uuid,uuid)','set_frontend_cipc_office_visibility(uuid,boolean)','correct_frontend_cipc_office(uuid,timestamptz,text,uuid,jsonb)','get_my_frontend_business_review_state(uuid)','get_frontend_business_review_queue(text)','get_frontend_cipc_case(uuid)'] loop
    audience:=case when signature like 'record_frontend_cipc_parse%' or signature like 'get_frontend_cipc_preview%' or signature like '%_cipc_email%' then 'service_role' else 'authenticated' end;
    foreach ns in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',ns,signature);
      execute format('grant execute on function %I.%s to %I',ns,signature,audience);
    end loop;
  end loop;
end$$;
notify pgrst,'reload schema';
commit;

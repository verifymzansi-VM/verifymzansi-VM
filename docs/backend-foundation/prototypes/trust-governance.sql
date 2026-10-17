-- BF-08 trust, governance, retention and object journal candidate.
-- Staff authority is re-derived on every call from live rows: non-anonymous
-- AAL2 JWT, live auth session, unbanned account, active role with an explicit
-- capability, and (for sensitive capabilities) a TOTP verification within 15
-- minutes. Evidence bytes never pass through the database; it holds the
-- upload journal, opaque artifact ids, durable access audit and deletion state.

create table private.staff_capabilities (
  role text not null check (role in ('moderator', 'governor', 'admin')),
  capability text not null check (capability ~ '^[a-z_]+:[a-z_]+$'),
  requires_recent_mfa boolean not null default false,
  primary key (role, capability)
);
insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('moderator', 'queue:view', false),
  ('moderator', 'case:claim', false),
  ('moderator', 'evidence:view', true),
  ('moderator', 'verification:decide_routine', true),
  ('governor', 'queue:view', false),
  ('governor', 'case:claim', false),
  ('governor', 'evidence:view', true),
  ('governor', 'verification:decide_routine', true),
  ('governor', 'decision:propose', true),
  ('governor', 'decision:approve', true),
  ('governor', 'decision:withdraw', true),
  ('governor', 'legal_hold:manage', true),
  ('admin', 'queue:view', false),
  ('admin', 'decision:propose', true),
  ('admin', 'decision:approve', true),
  ('admin', 'decision:withdraw', true),
  ('admin', 'legal_hold:manage', true),
  ('admin', 'role:manage', true);

create table private.staff_roles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('moderator', 'governor', 'admin')),
  granted_by uuid references auth.users (id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index staff_roles_one_active_idx on private.staff_roles (user_id) where revoked_at is null;

-- The last active administrator cannot be revoked or demoted.
create function internal.staff_last_admin_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if old.role = 'admin' and old.revoked_at is null
    and (new.revoked_at is not null or new.role <> 'admin')
    and not exists (select 1 from private.staff_roles r where r.role = 'admin' and r.revoked_at is null and r.id <> old.id) then
    raise exception 'the last active administrator cannot be removed' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.staff_last_admin_guard() from public, anon, authenticated, service_role;
create trigger staff_last_admin before update on private.staff_roles
  for each row execute function internal.staff_last_admin_guard();

create function internal.staff_actor(p_capability text)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
  claims jsonb := auth.jwt();
  needs_mfa boolean;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean, false) or claims->>'aal' is distinct from 'aal2' then
    raise exception 'staff session with second factor required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id::text = claims->>'session_id' and s.user_id = actor
      and s.aal = 'aal2' and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'live staff session required' using errcode = '42501';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = actor) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  select c.requires_recent_mfa into needs_mfa
  from private.staff_roles r join private.staff_capabilities c on c.role = r.role
  where r.user_id = actor and r.revoked_at is null and c.capability = p_capability;
  if not found then raise exception 'capability not granted' using errcode = '42501'; end if;
  if needs_mfa and not exists (
      select 1 from jsonb_array_elements(coalesce(claims->'amr', '[]')) a
      where a->>'method' = 'totp' and (a->>'timestamp')::bigint >= extract(epoch from clock_timestamp() - interval '15 minutes')) then
    raise exception 'recent second-factor verification required' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function internal.staff_actor(text) from public, anon, authenticated, service_role;
grant execute on function internal.staff_actor(text) to authenticated;

-- Evidence cases and the upload journal. Object keys are generated here, never
-- accepted from a client, and never returned to staff browsers.
create table private.evidence_cases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  subject_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('kyc', 'business', 'restriction')),
  status text not null default 'open' check (status in ('open', 'decided', 'closed')),
  claimed_by uuid references auth.users (id) on delete restrict,
  claim_expires_at timestamptz,
  claim_generation bigint not null default 0 check(claim_generation>=0),
  claim_nonce uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  unique(id,subject_id),
  check ((claimed_by is null and claim_expires_at is null and claim_nonce is null)
    or (claimed_by is not null and claim_expires_at is not null and claim_nonce is not null and claim_generation>0)),
  check (status='open' or claimed_by is null)
);

create table private.evidence_artifacts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete restrict,
  purpose text not null check (purpose in ('id_front', 'id_back', 'selfie', 'proof_of_address', 'registration')),
  object_key text not null unique,
  state text not null default 'intent'
    check (state in ('intent', 'uploaded', 'clean', 'rejected', 'cleanup_required', 'deleted')),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer check (size_bytes between 1 and 20000000),
  created_at timestamptz not null default statement_timestamp(),
  state_changed_at timestamptz not null default statement_timestamp(),
  retain_until timestamptz,
  deleted_at timestamptz,
  foreign key(case_id,owner_id) references private.evidence_cases(id,subject_id) on delete restrict,
  check ((state in ('intent', 'cleanup_required', 'deleted', 'rejected')) or sha256 is not null),
  check ((state = 'deleted') = (deleted_at is not null))
);
create index evidence_artifacts_due_idx on private.evidence_artifacts (retain_until) where state = 'clean';
create index evidence_artifacts_intent_idx on private.evidence_artifacts (created_at) where state = 'intent';
create index evidence_artifacts_case_idx on private.evidence_artifacts(case_id,id);
create index evidence_cases_subject_idx on private.evidence_cases(subject_id,id);

-- Evidence commands share subject -> case -> artifact lock order. This includes
-- account closure and holds; no command may acquire an artifact first.
create function internal.lock_evidence_subject(p_subject uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_subject is null then raise exception 'evidence subject required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_subject::text,2408));
end;
$$;
revoke all on function internal.lock_evidence_subject(uuid) from public,anon,authenticated,service_role;

create function internal.evidence_case_identity_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.subject_id,new.kind,new.created_at) is distinct from (old.id,old.subject_id,old.kind,old.created_at) then
    raise exception 'evidence case identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.evidence_case_identity_guard() from public,anon,authenticated,service_role;
create trigger evidence_case_identity before update on private.evidence_cases
  for each row execute function internal.evidence_case_identity_guard();

-- Every mutation of the reviewed artifact set invalidates an older proposal.
-- Retention clocks alone are operational and do not change reviewed content.
create function internal.evidence_artifact_submission_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare subject uuid; case_id uuid; c private.evidence_cases; relevant boolean;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=case_id and e.subject_id=subject for update;
  if not found then raise exception 'artifact subject must match case' using errcode='23514'; end if;
  if tg_op='INSERT' then
    relevant:=true;
    if c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  elsif tg_op='DELETE' then relevant:=true;
  else
    relevant:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes);
    if relevant and new.state in ('uploaded','clean','rejected') and
      (c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject)) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  end if;
  if relevant then
    update private.evidence_cases set version=version+1 where id=c.id and version<2147483647;
    if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function internal.evidence_artifact_submission_guard() from public,anon,authenticated,service_role;
create trigger evidence_artifact_submission before insert or update or delete on private.evidence_artifacts
  for each row execute function internal.evidence_artifact_submission_guard();

create function internal.evidence_case_snapshot(p_case uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'purpose',a.purpose,
    'object_key',a.object_key,'state',a.state,'sha256',a.sha256,'size_bytes',a.size_bytes)
    order by a.id),'[]'::jsonb)
  from private.evidence_artifacts a where a.case_id=p_case;
$$;
revoke all on function internal.evidence_case_snapshot(uuid) from public,anon,authenticated,service_role;

-- Allowed journal transitions only; deleted is terminal.
create function internal.evidence_artifact_transition_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (new.id, new.case_id, new.owner_id, new.purpose, new.object_key) is distinct from
     (old.id, old.case_id, old.owner_id, old.purpose, old.object_key) then
    raise exception 'artifact identity is immutable' using errcode = '23514';
  end if;
  if new.state <> old.state and not (
      (old.state = 'intent' and new.state in ('uploaded', 'cleanup_required'))
      or (old.state = 'uploaded' and new.state in ('clean', 'rejected', 'cleanup_required'))
      or (old.state in ('clean', 'rejected') and new.state = 'cleanup_required')
      or (old.state = 'cleanup_required' and new.state = 'deleted')) then
    raise exception 'invalid artifact transition % -> %', old.state, new.state using errcode = '23514';
  end if;
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'artifact digest is immutable' using errcode = '23514';
  end if;
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$$;
revoke all on function internal.evidence_artifact_transition_guard() from public, anon, authenticated, service_role;
create trigger evidence_artifact_transition before update on private.evidence_artifacts
  for each row execute function internal.evidence_artifact_transition_guard();

create table private.legal_holds (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  subject_id uuid not null references auth.users (id) on delete restrict,
  reason text not null check (length(reason) between 5 and 500),
  placed_by uuid not null references auth.users (id) on delete restrict,
  placed_at timestamptz not null default statement_timestamp(),
  released_by uuid references auth.users (id) on delete restrict,
  released_at timestamptz,
  check ((released_at is null) = (released_by is null))
);
create index legal_holds_active_idx on private.legal_holds (subject_id) where released_at is null;

-- Append-only, written in the same transaction as the read it records.
create table private.evidence_access_log (
  id bigint generated always as identity primary key,
  staff_id uuid not null references auth.users (id) on delete restrict,
  case_id uuid not null references private.evidence_cases (id) on delete restrict,
  purpose text not null,
  case_version integer not null check(case_version>0),
  claim_generation bigint not null check(claim_generation>0),
  artifact_ids uuid[] not null,
  accessed_at timestamptz not null default statement_timestamp()
);
create table private.decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null references private.evidence_cases (id) on delete restrict,
  action text not null check (action in ('approve_override', 'reject', 'restrict_account')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2048),
  case_version integer not null check(case_version>0),
  reviewed_snapshot jsonb not null check(jsonb_typeof(reviewed_snapshot)='array'),
  proposed_by uuid not null references auth.users (id) on delete restrict,
  proposed_at timestamptz not null default statement_timestamp(),
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete restrict,
  withdrawn_at timestamptz,
  withdrawn_case_version integer check(withdrawn_case_version>0),
  withdrawal_reason text,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'withdrawn')),
  check ((status='approved' and approved_by is not null and approved_at is not null)
    or (status<>'approved' and approved_by is null and approved_at is null)),
  check ((status='withdrawn' and withdrawn_by is not null and withdrawn_at is not null
      and withdrawn_case_version is not null and withdrawal_reason is not null)
    or (status<>'withdrawn' and withdrawn_by is null and withdrawn_at is null
      and withdrawn_case_version is null and withdrawal_reason is null)),
  check (approved_by is distinct from proposed_by)
);
create unique index decisions_one_open_idx on private.decisions (case_id) where status = 'proposed';

create function internal.append_only_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function internal.append_only_guard() from public, anon, authenticated, service_role;
create trigger evidence_access_log_append_only before update or delete on private.evidence_access_log
  for each row execute function internal.append_only_guard();
create trigger evidence_access_log_no_truncate before truncate on private.evidence_access_log
  for each statement execute function internal.append_only_guard();

-- A decision's subject, action, payload and bound case version never change after proposal.
create function internal.decision_binding_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then raise exception 'decisions are retained' using errcode = '23514'; end if;
  if (new.id,new.case_id, new.action, new.payload, new.case_version, new.reviewed_snapshot, new.proposed_by, new.proposed_at)
     is distinct from (old.id,old.case_id, old.action, old.payload, old.case_version, old.reviewed_snapshot, old.proposed_by, old.proposed_at)
    or old.status <> 'proposed' then
    raise exception 'decision is bound to its proposal' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.decision_binding_guard() from public, anon, authenticated, service_role;
create trigger decision_binding before update or delete on private.decisions
  for each row execute function internal.decision_binding_guard();

-- DEC-22: identity evidence is kept while the account exists and deleted 90
-- days after the account is deleted. The auth user row is retained
-- (anonymised by the deletion flow) until then, because evidence and audit
-- rows restrict its removal.
create table private.account_closures (
  user_id uuid primary key references auth.users (id) on delete restrict,
  closed_at timestamptz not null default statement_timestamp(),
  evidence_delete_after timestamptz not null,
  check (evidence_delete_after = closed_at + interval '90 days')
);

alter table private.staff_capabilities enable row level security;
alter table private.staff_roles enable row level security;
alter table private.evidence_cases enable row level security;
alter table private.evidence_artifacts enable row level security;
alter table private.legal_holds enable row level security;
alter table private.evidence_access_log enable row level security;
alter table private.decisions enable row level security;
alter table private.account_closures enable row level security;
revoke all on private.account_closures from public, anon, authenticated, service_role;

-- Current account authority, shared by owner commands and public resource reads.
-- Approved restrict_account decisions fail closed until an explicit reviewed
-- lift/appeal model exists. Proposals and withdrawals have no authority.
create index decisions_approved_restriction_idx on private.decisions(case_id)
  where status='approved' and action='restrict_account';
create view private.current_account_access with (security_invoker=true) as
  select u.id from auth.users u
  where u.is_anonymous is false and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=statement_timestamp())
    and not exists(select 1 from private.account_closures c where c.user_id=u.id)
    and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
      where c.subject_id=u.id and d.status='approved' and d.action='restrict_account');
revoke all on private.current_account_access from public,anon,authenticated,service_role;

create or replace function internal.price_draft_actor()
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean,false)
    or not exists(select 1 from private.current_account_access u where u.id=actor) then
    raise exception 'active authenticated member required' using errcode='42501';
  end if;
  if not exists(select 1 from auth.sessions s where s.id::text=claims->>'session_id'
    and s.user_id=actor and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'live session required' using errcode='42501';
  end if;
  return actor;
end;
$$;
revoke all on function internal.price_draft_actor() from public,anon,authenticated,service_role;
grant execute on function internal.price_draft_actor() to authenticated;
revoke all on private.staff_capabilities, private.staff_roles, private.evidence_cases, private.evidence_artifacts,
  private.legal_holds, private.evidence_access_log, private.decisions
  from public, anon, authenticated, service_role;

-- Owner: open an upload intent before any bytes are written. The server-side
-- Worker then writes encrypted bytes to exactly this key.
create function internal.begin_evidence_upload(p_case_id uuid, p_purpose text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); art private.evidence_artifacts;
begin
  perform internal.lock_evidence_subject(actor);
  actor:=internal.price_draft_actor();
  if exists(select 1 from private.evidence_cases c where c.id=p_case_id and c.subject_id=actor and c.kind='kyc')
    and p_purpose in('id_front','id_back','selfie') then
    if exists(select 1 from private.accepted_identity_facts f where f.owner_id=actor) then
      raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
    if exists(select 1 from private.decisions d where d.case_id=p_case_id and d.status='proposed'
      and d.action='approve_override' and d.payload ? 'identity_submission_id') then
      raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  end if;
  perform c.id from private.evidence_cases c where c.id=p_case_id and c.subject_id=actor and c.status='open'
    and c.kind in('kyc','business') for update;
  if not found then
    raise exception 'case not open for this member' using errcode = '22023';
  end if;
  if exists (select 1 from private.account_closures x where x.user_id = actor) then
    raise exception 'account is closed' using errcode = '42501';
  end if;
  if (select count(*) from private.evidence_artifacts a where a.case_id = p_case_id and a.state = 'intent') >= 5 then
    raise exception 'too many unfinished uploads' using errcode = 'PT429';
  end if;
  insert into private.evidence_artifacts (case_id, owner_id, purpose, object_key)
  values (p_case_id, actor, p_purpose, 'evidence/' || p_case_id || '/' || pg_catalog.gen_random_uuid())
  returning * into art;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('artifact_id', art.id, 'state', art.state);
end;
$$;
revoke all on function internal.begin_evidence_upload(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.begin_evidence_upload(uuid, text) to authenticated;
create function api.begin_evidence_upload(p_case_id uuid, p_purpose text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.begin_evidence_upload(p_case_id, p_purpose);
$$;
revoke all on function api.begin_evidence_upload(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.begin_evidence_upload(uuid, text) to authenticated;

-- Server: advance the journal (uploaded -> clean/rejected after scanning,
-- cleanup_required, deleted after the object store confirms deletion).
create function internal.advance_evidence_artifact(p_artifact_id uuid, p_state text, p_sha256 text, p_size integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare art private.evidence_artifacts; subject uuid; case_id uuid;
begin
  select a.owner_id,a.case_id into subject,case_id from private.evidence_artifacts a where a.id=p_artifact_id;
  if not found then raise exception 'artifact not found' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  perform c.id from private.evidence_cases c where c.id=case_id for update;
  select * into art from private.evidence_artifacts a where a.id = p_artifact_id for update;
  if not found then raise exception 'artifact not found' using errcode = '22023'; end if;
  if p_sha256 is not null and p_sha256 !~ '^[a-f0-9]{64}$'
    or p_size is not null and p_size not between 1 and 20000000 then
    raise exception 'valid digest and bounded size required' using errcode='22023';
  end if;
  if (p_sha256 is not null and art.sha256 is not null and p_sha256 is distinct from art.sha256)
    or (p_size is not null and art.size_bytes is not null and p_size is distinct from art.size_bytes) then
    raise exception 'artifact metadata conflicts with stored upload' using errcode='PT409';
  end if;
  if p_state = 'deleted' and exists (select 1 from private.legal_holds h
      where h.subject_id = art.owner_id and h.released_at is null) then
    raise exception 'legal hold blocks deletion' using errcode = '23514';
  end if;
  update private.evidence_artifacts set state = p_state,
    sha256 = coalesce(sha256, p_sha256), size_bytes = coalesce(size_bytes, p_size),
    deleted_at = case when p_state = 'deleted' then statement_timestamp() end
  where id = art.id returning * into art;
  return jsonb_build_object('artifact_id', art.id, 'state', art.state);
end;
$$;
revoke all on function internal.advance_evidence_artifact(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function internal.advance_evidence_artifact(uuid, text, text, integer) to service_role;
create function api.advance_evidence_artifact(p_artifact_id uuid, p_state text, p_sha256 text default null, p_size integer default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.advance_evidence_artifact(p_artifact_id, p_state, p_sha256, p_size);
$$;
revoke all on function api.advance_evidence_artifact(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function api.advance_evidence_artifact(uuid, text, text, integer) to service_role;

-- Server sweep: abandoned intents and expired, unheld evidence become
-- cleanup_required; the Worker deletes bytes and then marks them deleted.
-- Returns the object keys to delete (server only).
create function internal.claim_evidence_cleanup(p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare rows jsonb:='[]'::jsonb; candidate record; art private.evidence_artifacts;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'limit 1 to 500' using errcode = '22023'; end if;
  for candidate in
    select a.id,a.owner_id,a.case_id from private.evidence_artifacts a
    where ((a.state = 'intent' and a.created_at < statement_timestamp() - interval '1 hour')
        or (a.state in ('uploaded', 'clean', 'rejected') and a.retain_until <= statement_timestamp()))
      and not exists (select 1 from private.legal_holds h where h.subject_id = a.owner_id and h.released_at is null)
    order by a.owner_id,a.case_id,a.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    perform c.id from private.evidence_cases c where c.id=candidate.case_id for update skip locked;
    if not found then continue; end if;
    select a.* into art from private.evidence_artifacts a where a.id=candidate.id for update skip locked;
    if not found then continue; end if;
    -- Fresh checks after the shared lock order, including newly placed holds.
    if not ((art.state='intent' and art.created_at<statement_timestamp()-interval '1 hour')
      or (art.state in ('uploaded','clean','rejected') and art.retain_until<=statement_timestamp()))
      or exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null) then continue; end if;
    update private.evidence_artifacts set state='cleanup_required' where id=art.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('artifact_id',art.id,'object_key',art.object_key));
  end loop;
  return rows;
end;
$$;
revoke all on function internal.claim_evidence_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_evidence_cleanup(integer) to service_role;
create function api.claim_evidence_cleanup(p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_evidence_cleanup(p_limit);
$$;
revoke all on function api.claim_evidence_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_evidence_cleanup(integer) to service_role;

-- Staff: claim a case for review (never one's own; claims expire).
create function internal.claim_evidence_case(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('case:claim'); c private.evidence_cases; subject uuid;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id and e.status = 'open' for update;
  if not found then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('case:claim');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  if c.claimed_by is not null and c.claimed_by <> actor and c.claim_expires_at > clock_timestamp() then
    raise exception 'case claimed by another reviewer' using errcode = 'PT409';
  end if;
  update private.evidence_cases set claimed_by = actor, claim_expires_at = clock_timestamp() + interval '30 minutes',
    claim_generation=claim_generation+1,claim_nonce=pg_catalog.gen_random_uuid()
  where id = c.id and claim_generation<9223372036854775807 returning * into c;
  if not found then raise exception 'claim generation exhausted' using errcode='PT409'; end if;
  return jsonb_build_object('case_id', c.id, 'version', c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at', c.claim_expires_at);
end;
$$;
revoke all on function internal.claim_evidence_case(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.claim_evidence_case(uuid) to authenticated;
create function api.claim_evidence_case(p_case_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_evidence_case(p_case_id);
$$;
revoke all on function api.claim_evidence_case(uuid) from public, anon, authenticated, service_role;
grant execute on function api.claim_evidence_case(uuid) to authenticated;

create function internal.assert_evidence_claim(p_case private.evidence_cases,p_actor uuid,p_generation text,p_nonce uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_generation is null or p_generation !~ '^[1-9][0-9]{0,18}$' or p_nonce is null then
    raise exception 'current claim generation and nonce required' using errcode='22023';
  end if;
  if p_case.status<>'open' or p_case.subject_id=p_actor or p_case.claimed_by is distinct from p_actor
    or p_case.claim_generation::text is distinct from p_generation or p_case.claim_nonce is distinct from p_nonce
    or p_case.claim_expires_at is null or p_case.claim_expires_at<=clock_timestamp() then
    raise exception 'current live evidence claim required' using errcode='42501';
  end if;
end;
$$;
revoke all on function internal.assert_evidence_claim(private.evidence_cases,uuid,text,uuid) from public,anon,authenticated,service_role;

create function internal.renew_evidence_claim(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim'); subject uuid; c private.evidence_cases;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case_id for update;
  actor:=internal.staff_actor('case:claim');
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  update private.evidence_cases set claim_expires_at=clock_timestamp()+interval '30 minutes' where id=c.id returning * into c;
  return jsonb_build_object('case_id',c.id,'version',c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at',c.claim_expires_at);
end;
$$;
revoke all on function internal.renew_evidence_claim(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.renew_evidence_claim(uuid,text,uuid) to authenticated;
create function api.renew_evidence_claim(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.renew_evidence_claim(p_case_id,p_claim_generation,p_claim_nonce);
$$;
revoke all on function api.renew_evidence_claim(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.renew_evidence_claim(uuid,text,uuid) to authenticated;

-- Staff: evidence metadata for a claimed case. The access row commits with the
-- read or the read fails. Opaque ids only: no object keys, hashes or provider data.
create function internal.staff_evidence_metadata(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('evidence:view'); c private.evidence_cases; items jsonb; ids uuid[]; subject uuid;
begin
  if p_purpose is null or p_purpose not in ('routine_review', 'override_review', 'appeal_review') then
    raise exception 'access purpose required' using errcode = '22023';
  end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id for update;
  if not found or c.status <> 'open' then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('evidence:view');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select coalesce(jsonb_agg(jsonb_build_object('artifact_id', a.id, 'purpose', a.purpose, 'size_bytes', a.size_bytes,
      'uploaded_at', a.created_at) order by a.created_at), '[]'), coalesce(array_agg(a.id), '{}')
  into items, ids
  from private.evidence_artifacts a
  where a.case_id = c.id and a.state = 'clean'
    and (a.retain_until is null or a.retain_until > clock_timestamp());
  insert into private.evidence_access_log (staff_id, case_id, purpose,case_version,claim_generation,artifact_ids)
    values (actor,c.id,p_purpose,c.version,c.claim_generation,ids);
  return jsonb_build_object('case_id', c.id, 'version', c.version, 'artifacts', items);
end;
$$;
revoke all on function internal.staff_evidence_metadata(uuid,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.staff_evidence_metadata(uuid,text,uuid,text) to authenticated;
create function api.staff_evidence_metadata(p_case_id uuid,p_claim_generation text,p_claim_nonce uuid,p_purpose text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.staff_evidence_metadata(p_case_id,p_claim_generation,p_claim_nonce,p_purpose);
$$;
revoke all on function api.staff_evidence_metadata(uuid,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.staff_evidence_metadata(uuid,text,uuid,text) to authenticated;

-- Two-person decisions bound to the reviewed case version.
create function internal.propose_decision(p_case_id uuid, p_expected_version integer, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('decision:propose'); c private.evidence_cases; d private.decisions; subject uuid;
begin
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 then
    raise exception 'positive expected case version required' using errcode='22023';
  end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id for update;
  if not found or c.status <> 'open' then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:propose');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  if c.version <> p_expected_version then raise exception 'case changed since review' using errcode = 'PT409'; end if;
  insert into private.decisions (case_id, action, payload, case_version, reviewed_snapshot, proposed_by)
  values (c.id, p_action, coalesce(p_payload, '{}'), c.version, internal.evidence_case_snapshot(c.id), actor) returning * into d;
  return jsonb_build_object('decision_id', d.id, 'case_version', d.case_version);
end;
$$;
revoke all on function internal.propose_decision(uuid, integer, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.propose_decision(uuid, integer, text, jsonb) to authenticated;
create function api.propose_decision(p_case_id uuid, p_expected_version integer, p_action text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.propose_decision(p_case_id, p_expected_version, p_action, p_payload);
$$;
revoke all on function api.propose_decision(uuid, integer, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function api.propose_decision(uuid, integer, text, jsonb) to authenticated;

-- Withdraw an authored proposal, or recover another reviewer's obsolete one.
-- Finalized audit is immutable. Retries return the original result only for
-- the same current-authority actor and normalized reason; no second write.
create function internal.withdraw_decision(p_decision_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:withdraw'); subject uuid; case_id uuid;
  c private.evidence_cases; d private.decisions; reason text;
begin
  if p_expected_version is null or p_expected_version<1 then
    raise exception 'positive expected current case version required' using errcode='22023';
  end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  select x.case_id,e.subject_id into case_id,subject
    from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision_id;
  if not found then raise exception 'proposal unavailable' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=case_id for update;
  select x.* into d from private.decisions x where x.id=p_decision_id for update;
  if not found then raise exception 'proposal unavailable' using errcode='22023'; end if;
  actor:=internal.staff_actor('decision:withdraw');
  if actor=c.subject_id then raise exception 'self-review is not allowed' using errcode='42501'; end if;
  if d.status='withdrawn' then
    if d.withdrawn_by=actor and d.withdrawal_reason=reason then
      return jsonb_build_object('decision_id',d.id,'status','withdrawn');
    end if;
    raise exception 'withdrawal already finalized by a different request' using errcode='PT409';
  end if;
  if d.status<>'proposed' then raise exception 'only pending proposals can be withdrawn' using errcode='22023'; end if;
  if c.version is distinct from p_expected_version then raise exception 'case changed since review' using errcode='PT409'; end if;
  if d.proposed_by<>actor and c.status='open' and c.version=d.case_version
    and internal.evidence_case_snapshot(c.id)=d.reviewed_snapshot then
    raise exception 'another reviewer may withdraw only an obsolete proposal' using errcode='42501';
  end if;
  update private.decisions set status='withdrawn',withdrawn_by=actor,withdrawn_at=clock_timestamp(),
    withdrawn_case_version=c.version,withdrawal_reason=reason where id=d.id;
  return jsonb_build_object('decision_id',d.id,'status','withdrawn');
end;
$$;
revoke all on function internal.withdraw_decision(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.withdraw_decision(uuid,integer,text) to authenticated;
create function api.withdraw_decision(p_decision_id uuid,p_expected_version integer,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.withdraw_decision(p_decision_id,p_expected_version,p_reason);
$$;
revoke all on function api.withdraw_decision(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function api.withdraw_decision(uuid,integer,text) to authenticated;

create function internal.approve_decision(p_decision_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('decision:approve'); d private.decisions; c private.evidence_cases; case_id uuid; subject uuid;
begin
  select x.case_id,e.subject_id into case_id,subject from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision_id;
  if not found then raise exception 'decision not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id=case_id for update;
  select * into d from private.decisions x where x.id = p_decision_id for update;
  if not found or d.status <> 'proposed' then raise exception 'decision not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:approve');
  if actor in (d.proposed_by, c.subject_id) then
    raise exception 'a second, independent approver is required' using errcode = '42501';
  end if;
  if c.version is distinct from d.case_version or c.status <> 'open'
    or internal.evidence_case_snapshot(c.id) is distinct from d.reviewed_snapshot then
    raise exception 'case changed after proposal' using errcode = 'PT409';
  end if;
  update private.decisions set status = 'approved', approved_by = actor, approved_at = statement_timestamp()
  where id = d.id;
  update private.evidence_cases set status = 'decided', version = version + 1, claimed_by = null, claim_expires_at = null,claim_nonce=null
  where id = c.id;
  return jsonb_build_object('decision_id', d.id, 'status', 'approved');
end;
$$;
revoke all on function internal.approve_decision(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.approve_decision(uuid) to authenticated;
create function api.approve_decision(p_decision_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.approve_decision(p_decision_id);
$$;
revoke all on function api.approve_decision(uuid) from public, anon, authenticated, service_role;
grant execute on function api.approve_decision(uuid) to authenticated;

create function internal.place_legal_hold(p_subject_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('legal_hold:manage'); h private.legal_holds;
begin
  if p_subject_id = actor then raise exception 'cannot hold own account' using errcode = '42501'; end if;
  perform internal.lock_evidence_subject(p_subject_id);
  actor:=internal.staff_actor('legal_hold:manage');
  insert into private.legal_holds (subject_id, reason, placed_by) values (p_subject_id, p_reason, actor) returning * into h;
  return jsonb_build_object('hold_id', h.id);
end;
$$;
revoke all on function internal.place_legal_hold(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.place_legal_hold(uuid, text) to authenticated;
create function api.place_legal_hold(p_subject_id uuid, p_reason text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.place_legal_hold(p_subject_id, p_reason);
$$;
revoke all on function api.place_legal_hold(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.place_legal_hold(uuid, text) to authenticated;

-- Server: called by the account-deletion transaction. Idempotent; the clock
-- starts at the first call and every retained artifact gets the same deadline.
create function internal.close_account_evidence(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare closure private.account_closures; scheduled integer; trial_fingerprints integer;
begin
  perform internal.lock_evidence_subject(p_user_id);
  perform e.id from private.evidence_cases e where e.subject_id=p_user_id order by e.id for update;
  insert into private.account_closures (user_id, closed_at, evidence_delete_after)
  values (p_user_id, statement_timestamp(), statement_timestamp() + interval '90 days')
  on conflict (user_id) do nothing;
  select * into closure from private.account_closures x where x.user_id = p_user_id;
  update private.evidence_artifacts a set retain_until = closure.evidence_delete_after
  where a.owner_id = p_user_id and a.state in ('uploaded', 'clean', 'rejected')
    and a.retain_until is distinct from closure.evidence_delete_after;
  get diagnostics scheduled = row_count;
  -- DEC-27: detach the trial fingerprint and keep it 3 years after closure.
  update private.trial_identities set owner_id = null, entitlement_id = null,
    detached_at = closure.closed_at, retain_until = closure.closed_at + interval '3 years'
  where owner_id = p_user_id;
  get diagnostics trial_fingerprints = row_count;
  update private.evidence_cases set status = 'closed', claimed_by = null, claim_expires_at = null,claim_nonce=null,
    version=least(version::bigint+1,2147483647)::integer
  where subject_id = p_user_id and status = 'open' and kind in('kyc','business');
  return jsonb_build_object('closed_at', closure.closed_at,
    'evidence_delete_after', closure.evidence_delete_after, 'scheduled', scheduled,
    'trial_fingerprints_detached', trial_fingerprints);
end;
$$;
revoke all on function internal.close_account_evidence(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.close_account_evidence(uuid) to service_role;
create function api.close_account_evidence(p_user_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.close_account_evidence(p_user_id);
$$;
revoke all on function api.close_account_evidence(uuid) from public, anon, authenticated, service_role;
grant execute on function api.close_account_evidence(uuid) to service_role;

-- Banned identities (DEC-30). When an approved restrict_account decision bans
-- a verified person, the server records the keyed HMAC of their ID number (the
-- number itself is never stored) so a new account with the same ID is refused.
-- The fingerprint is kept 5 years from the ban, then purged; a later ban of the
-- same identity restarts the period. Only a reason category is kept, never an
-- accusation. ID documents still follow DEC-22 (90 days after account deletion).
create table private.banned_identities (
  identity_hmac text primary key check (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  decision_id uuid not null references private.decisions (id) on delete restrict,
  category text not null check (category in ('fraud', 'fake_listings', 'harassment', 'impersonation', 'repeat_abuse', 'other')),
  banned_at timestamptz not null default statement_timestamp(),
  retain_until timestamptz not null,
  check (retain_until = banned_at + interval '5 years')
);
create index banned_identities_expiry_idx on private.banned_identities (retain_until);
alter table private.banned_identities enable row level security;
revoke all on private.banned_identities from public, anon, authenticated, service_role;

-- Server only, after an approved restriction. Idempotent per identity.
create function internal.record_identity_ban(p_decision_id uuid, p_identity_hmac text, p_category text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare ban private.banned_identities; decision private.decisions; deadline timestamptz;
begin
  if p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' then
    raise exception 'identity fingerprint required' using errcode='22023';
  end if;
  if p_category is null or p_category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
    raise exception 'ban category required' using errcode='22023';
  end if;
  select d.* into decision from private.decisions d where d.id=p_decision_id and d.status='approved' and d.action='restrict_account';
  if not found then raise exception 'an approved account restriction is required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_identity_hmac,2701));
  select b.* into ban from private.banned_identities b where b.identity_hmac=p_identity_hmac for update;
  if found and ban.decision_id=p_decision_id then
    if ban.category is distinct from p_category then raise exception 'conflicting ban retry' using errcode='PT409'; end if;
    return jsonb_build_object('banned',ban.retain_until>clock_timestamp(),'retain_until',ban.retain_until);
  end if;
  if ban.identity_hmac is not null and decision.approved_at<ban.banned_at then
    raise exception 'restriction event is older than current ban' using errcode='PT409';
  end if;
  -- Retention starts at the approved restriction event, never its retry or a
  -- delayed callback. Replaying an already-expired event cannot resurrect it.
  deadline:=decision.approved_at+interval '5 years';
  if deadline<=clock_timestamp() then return jsonb_build_object('banned',false,'retain_until',deadline); end if;
  insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
  values(p_identity_hmac,p_decision_id,p_category,decision.approved_at,deadline)
  on conflict(identity_hmac) do update set decision_id=excluded.decision_id,category=excluded.category,
    banned_at=excluded.banned_at,retain_until=excluded.retain_until returning * into ban;
  return jsonb_build_object('banned',true,'retain_until',ban.retain_until);
end;
$$;
revoke all on function internal.record_identity_ban(uuid, text, text) from public, anon, authenticated, service_role;
-- Raw core helper has no client/service EXECUTE; trusted derived commands call it as owner.
-- Raw API driver lives only in fixture-core-drivers.sql, excluded from target.

-- Server only, during ID verification: is this identity banned or has it used
-- its free trial? Returns facts only, never the decision or other accounts.
create function internal.identity_status(p_identity_hmac text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  if p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' then
    raise exception 'identity fingerprint required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'banned', exists (select 1 from private.banned_identities b where b.identity_hmac = p_identity_hmac and b.retain_until>clock_timestamp()),
    'trial_used', exists (select 1 from private.trial_identities t where t.identity_hmac = p_identity_hmac));
end;
$$;
revoke all on function internal.identity_status(text) from public, anon, authenticated, service_role;
grant execute on function internal.identity_status(text) to service_role;
create function api.identity_status(p_identity_hmac text)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.identity_status(p_identity_hmac);
$$;
revoke all on function api.identity_status(text) from public, anon, authenticated, service_role;
grant execute on function api.identity_status(text) to service_role;

-- Server-only sweep: purge bans whose 5-year period has ended.
create function internal.purge_expired_identity_bans(p_limit integer)
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  with due as (
    select b.identity_hmac from private.banned_identities b
    where b.retain_until <= statement_timestamp()
    order by b.retain_until limit p_limit
    for update skip locked
  )
  delete from private.banned_identities b using due where b.identity_hmac = due.identity_hmac;
  get diagnostics n = row_count;
  with due as (select b.decision_id from private.identity_ban_bindings b where b.retain_until<=clock_timestamp() order by b.retain_until limit p_limit for update skip locked)
  delete from private.identity_ban_bindings b using due where b.decision_id=due.decision_id;
  return n;
end;
$$;
revoke all on function internal.purge_expired_identity_bans(integer) from public, anon, authenticated, service_role;
grant execute on function internal.purge_expired_identity_bans(integer) to service_role;
create function api.purge_expired_identity_bans(p_limit integer)
returns integer language sql security invoker set search_path = pg_catalog as $$
  select internal.purge_expired_identity_bans(p_limit);
$$;
revoke all on function api.purge_expired_identity_bans(integer) from public, anon, authenticated, service_role;
grant execute on function api.purge_expired_identity_bans(integer) to service_role;

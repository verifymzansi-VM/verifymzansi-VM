-- Data retention (owner decision 22 October 2026, DEC-35). Every kind of
-- personal data has a deletion rule; the periods await legal confirmation.
-- ID photos and selfies are deleted 30 days after the case decision unless the
-- case carries an open fraud hold. Verification survives that deletion: a
-- decided case is judged on what was reviewed, not on bytes still stored.
-- One service command runs every sweep in bounded batches. The closure record,
-- approved account restrictions, the profile and the Auth user stay until the
-- account-deletion flow exists, because removing them would reactivate access.

insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('governor','evidence:fraud_hold',true),
  ('admin','evidence:fraud_hold',true);

-- Fraud holds keep a case's evidence past the 30-day rule until closed.
create table private.evidence_fraud_holds (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  case_id uuid not null references private.evidence_cases(id) on delete restrict,
  reason text not null check(length(reason) between 5 and 500),
  placed_by uuid not null references auth.users(id) on delete restrict,
  placed_at timestamptz not null default statement_timestamp(),
  closed_by uuid references auth.users(id) on delete restrict,
  closed_at timestamptz,
  close_reason text check(close_reason is null or length(close_reason) between 5 and 500),
  check((closed_at is null)=(closed_by is null) and (closed_at is null)=(close_reason is null))
);
create unique index evidence_fraud_holds_open_idx on private.evidence_fraud_holds(case_id) where closed_at is null;
create index evidence_fraud_holds_case_idx on private.evidence_fraud_holds(case_id,id);
alter table private.evidence_fraud_holds enable row level security;
revoke all on private.evidence_fraud_holds from public,anon,authenticated,service_role;

create function internal.evidence_fraud_hold_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.case_id,new.reason,new.placed_by,new.placed_at)
      is distinct from (old.id,old.case_id,old.reason,old.placed_by,old.placed_at)
    or old.closed_at is not null or new.closed_at is null then
    raise exception 'fraud holds are immutable except their first closure' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function internal.evidence_fraud_hold_guard() from public,anon,authenticated,service_role;
create trigger evidence_fraud_hold_guard before update on private.evidence_fraud_holds
  for each row execute function internal.evidence_fraud_hold_guard();

create function internal.evidence_fraud_held(p_case uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists(select 1 from private.evidence_fraud_holds h where h.case_id=p_case and h.closed_at is null);
$$;
revoke all on function internal.evidence_fraud_held(uuid) from public,anon,authenticated,service_role;

create function internal.retention_reason(p_reason text)
returns text language plpgsql security invoker set search_path=pg_catalog as $$
declare reason text;
begin
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  return reason;
end;
$$;
revoke all on function internal.retention_reason(text) from public,anon,authenticated,service_role;

create function internal.place_evidence_fraud_hold(p_case_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:fraud_hold'); subject uuid; reason text;
  hold private.evidence_fraud_holds; reused boolean:=true; kept integer;
begin
  reason:=internal.retention_reason(p_reason);
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  perform e.id from private.evidence_cases e where e.id=p_case_id for update;
  actor:=internal.staff_actor('evidence:fraud_hold');
  if actor=subject then raise exception 'self-review is not allowed' using errcode='42501'; end if;
  select h.* into hold from private.evidence_fraud_holds h where h.case_id=p_case_id and h.closed_at is null;
  if not found then
    insert into private.evidence_fraud_holds(case_id,reason,placed_by) values(p_case_id,reason,actor) returning * into hold;
    reused:=false;
  end if;
  select count(*) into kept from private.evidence_artifacts a
    where a.case_id=p_case_id and a.state in('uploaded','clean','rejected');
  return jsonb_build_object('hold_id',hold.id,'case_id',hold.case_id,'placed_at',hold.placed_at,
    'reused',reused,'retained_artifacts',kept);
end;
$$;
revoke all on function internal.place_evidence_fraud_hold(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.place_evidence_fraud_hold(uuid,text) to authenticated;
create function api.place_evidence_fraud_hold(p_case_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.place_evidence_fraud_hold(p_case_id,p_reason);
$$;
revoke all on function api.place_evidence_fraud_hold(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.place_evidence_fraud_hold(uuid,text) to authenticated;

-- Closing restarts the normal clock: evidence of a decided case is then due
-- at the later of its decision deadline and now.
create function internal.close_evidence_fraud_hold(p_case_id uuid,p_hold_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:fraud_hold'); subject uuid; closing_reason text;
  hold private.evidence_fraud_holds;
begin
  closing_reason:=internal.retention_reason(p_reason);
  if p_hold_id is null then raise exception 'expected hold required' using errcode='22023'; end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  perform e.id from private.evidence_cases e where e.id=p_case_id for update;
  actor:=internal.staff_actor('evidence:fraud_hold');
  if actor=subject then raise exception 'self-review is not allowed' using errcode='42501'; end if;
  select h.* into hold from private.evidence_fraud_holds h where h.id=p_hold_id and h.case_id=p_case_id
    and h.closed_at is null for update;
  if not found then
    select h.* into hold from private.evidence_fraud_holds h where h.id=p_hold_id and h.case_id=p_case_id;
    if found and hold.closed_by=actor and hold.close_reason=closing_reason then
      return jsonb_build_object('hold_id',hold.id,'case_id',hold.case_id,'closed_at',hold.closed_at,'reused',true);
    end if;
    raise exception 'no open fraud hold' using errcode='22023';
  end if;
  update private.evidence_fraud_holds set closed_by=actor,closed_at=statement_timestamp(),close_reason=closing_reason
    where id=hold.id returning * into hold;
  return jsonb_build_object('hold_id',hold.id,'case_id',hold.case_id,'closed_at',hold.closed_at,'reused',false);
end;
$$;
revoke all on function internal.close_evidence_fraud_hold(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.close_evidence_fraud_hold(uuid,uuid,text) to authenticated;
create function api.close_evidence_fraud_hold(p_case_id uuid,p_hold_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.close_evidence_fraud_hold(p_case_id,p_hold_id,p_reason);
$$;
revoke all on function api.close_evidence_fraud_hold(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.close_evidence_fraud_hold(uuid,uuid,text) to authenticated;

-- The decision starts the 30-day clock for every retained file of the case.
create function internal.evidence_decision_retention()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  update private.evidence_artifacts
    set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),statement_timestamp()+interval '30 days')
  where case_id=new.id and state in('uploaded','clean','rejected');
  return null;
end;
$$;
revoke all on function internal.evidence_decision_retention() from public,anon,authenticated,service_role;
create trigger evidence_decision_retention after update of status on private.evidence_cases
  for each row when(old.status='open' and new.status='decided') execute function internal.evidence_decision_retention();

-- Retiring files of a case that is no longer open is retention, not a change
-- to the reviewed submission: no version bump, no identity revocation.
create or replace function internal.evidence_artifact_submission_guard()
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
    relevant:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes)
      and not (c.status<>'open' and new.state in('cleanup_required','deleted')
        and (new.sha256,new.size_bytes) is not distinct from (old.sha256,old.size_bytes));
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

create or replace function internal.verification_evidence_invalidation()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare subject uuid; case_id uuid; material boolean; changed integer;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  material:=tg_op<>'UPDATE';
  if tg_op='UPDATE' then
    material:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes)
      and not (new.state in('cleanup_required','deleted')
        and (new.sha256,new.size_bytes) is not distinct from (old.sha256,old.size_bytes)
        and exists(select 1 from private.evidence_cases c where c.id=new.case_id and c.status<>'open'));
  end if;
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

-- The reviewed document and selfie were clean at acceptance; afterwards they
-- may only be retired by retention, which keeps the verification.
create function internal.verification_evidence_reviewed(p_submission uuid)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select exists(select 1 from private.verification_identity_submissions s
    join private.evidence_artifacts i on i.id=s.id_artifact_id and i.owner_id=s.owner_id and i.case_id=s.case_id
    join private.evidence_artifacts f on f.id=s.selfie_artifact_id and f.owner_id=s.owner_id and f.case_id=s.case_id
    where s.id=p_submission and i.purpose='id_front' and f.purpose='selfie'
      and i.state in('clean','cleanup_required','deleted') and f.state in('clean','cleanup_required','deleted'));
$$;
revoke all on function internal.verification_evidence_reviewed(uuid) from public,anon,authenticated,service_role;

create or replace function internal.current_verified_identity(p_owner uuid)
returns text language sql volatile security invoker set search_path=pg_catalog as $$
  select f.identity_hmac from private.accepted_identity_facts f
    join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases c on c.id=s.case_id and c.subject_id=p_owner
  where f.owner_id=p_owner and f.revoked_at is null and c.status='decided' and c.version=s.case_version+1
    and internal.verification_evidence_reviewed(s.id)
    and exists(select 1 from private.current_account_access a where a.id=p_owner)
    and exists(select 1 from private.verification_phone_proofs p where p.owner_id=p_owner and p.revoked_at is null)
    and exists(select 1 from private.verification_localities l where l.owner_id=p_owner);
$$;

-- Account closure never extends a sooner decision deadline.
create or replace function internal.close_account_evidence(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare closure private.account_closures; scheduled integer; trial_fingerprints integer;
begin
  perform internal.lock_evidence_subject(p_user_id);
  perform e.id from private.evidence_cases e where e.subject_id=p_user_id order by e.id for update;
  insert into private.account_closures (user_id, closed_at, evidence_delete_after)
  values (p_user_id, statement_timestamp(), statement_timestamp() + interval '90 days')
  on conflict (user_id) do nothing;
  select * into closure from private.account_closures x where x.user_id = p_user_id;
  update private.evidence_artifacts a
    set retain_until = least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after)
  where a.owner_id = p_user_id and a.state in ('uploaded', 'clean', 'rejected')
    and a.retain_until is distinct from least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after);
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

-- Due evidence under an open fraud hold stays until the hold closes.
create or replace function internal.claim_evidence_cleanup(p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare rows jsonb:='[]'::jsonb; candidate record; art private.evidence_artifacts;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'limit 1 to 500' using errcode = '22023'; end if;
  for candidate in
    select a.id,a.owner_id,a.case_id from private.evidence_artifacts a
    where ((a.state = 'intent' and a.created_at < statement_timestamp() - interval '1 hour')
        or (a.state in ('uploaded', 'clean', 'rejected') and a.retain_until <= statement_timestamp()
          and not internal.evidence_fraud_held(a.case_id)))
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
      or (art.state in ('uploaded','clean','rejected') and art.retain_until<=statement_timestamp()
        and not internal.evidence_fraud_held(art.case_id)))
      or exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null) then continue; end if;
    update private.evidence_artifacts set state='cleanup_required' where id=art.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('artifact_id',art.id,'object_key',art.object_key));
  end loop;
  return rows;
end;
$$;

-- The encrypted ID number goes with the files; only the keyed fingerprint stays.
alter table private.verification_identity_submissions
  alter column number_ciphertext drop not null,
  alter column number_iv drop not null,
  alter column number_tag drop not null,
  add column number_erased_at timestamptz,
  add constraint verification_submission_number_erasure check(
    (number_erased_at is null and number_ciphertext is not null and number_iv is not null and number_tag is not null)
    or (number_erased_at is not null and number_ciphertext is null and number_iv is null and number_tag is null));

create or replace function internal.verification_submission_immutable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if old.number_erased_at is null and new.number_erased_at is not null
    and new.number_ciphertext is null and new.number_iv is null and new.number_tag is null
    and (new.id,new.case_id,new.owner_id,new.case_version,new.id_artifact_id,new.selfie_artifact_id,
      new.identity_hmac,new.identity_key_id,new.protocol,new.encryption_key_id,new.receipt_id,new.recipe,
      new.risk_score,new.created_at)
    is not distinct from (old.id,old.case_id,old.owner_id,old.case_version,old.id_artifact_id,old.selfie_artifact_id,
      old.identity_hmac,old.identity_key_id,old.protocol,old.encryption_key_id,old.receipt_id,old.recipe,
      old.risk_score,old.created_at) then
    return new;
  end if;
  raise exception 'verification submission is immutable; replace with a new receipt' using errcode='23514';
end;
$$;

-- Append-only audit rows and finalised decisions may be deleted only by the
-- retention sweep, which marks its own transaction.
create or replace function internal.append_only_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op='DELETE' and current_setting('vm.retention',true)='on' then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;

create or replace function internal.decision_binding_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('vm.retention',true)='on' and old.status<>'proposed' then return old; end if;
    raise exception 'decisions are retained' using errcode = '23514';
  end if;
  if (new.id,new.case_id, new.action, new.payload, new.case_version, new.reviewed_snapshot, new.proposed_by, new.proposed_at)
     is distinct from (old.id,old.case_id, old.action, old.payload, old.case_version, old.reviewed_snapshot, old.proposed_by, old.proposed_at)
    or old.status <> 'proposed' then
    raise exception 'decision is bound to its proposal' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- South African tax year ends on the last day of February; financial records
-- are kept 5 years after the end of the tax year they belong to.
create function internal.retention_tax_year_due(p_at timestamptz)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select p_at is not null and pg_catalog.make_timestamptz(
      extract(year from p_at at time zone 'Africa/Johannesburg')::integer
        + case when extract(month from p_at at time zone 'Africa/Johannesburg')>=3 then 1 else 0 end,
      3,1,0,0,0,'Africa/Johannesburg') + interval '5 years' <= statement_timestamp();
$$;
revoke all on function internal.retention_tax_year_due(timestamptz) from public,anon,authenticated,service_role;

-- Identity numbers, phone codes and proofs, and details of closed accounts.
create function internal.retention_verification(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare candidate record; numbers integer:=0; challenges integer; proofs integer; localities integer;
  acceptances integer; histories integer:=0; cases uuid[];
begin
  for candidate in
    select s.id,s.owner_id,s.case_id from private.verification_identity_submissions s
      join private.evidence_cases c on c.id=s.case_id
      join private.evidence_artifacts a on a.id=s.id_artifact_id
    where s.number_erased_at is null and c.status<>'open'
      and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp())
      and not internal.evidence_fraud_held(s.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=s.owner_id and h.released_at is null)
    order by s.owner_id,s.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    update private.verification_identity_submissions
      set number_ciphertext=null,number_iv=null,number_tag=null,number_erased_at=statement_timestamp()
    where id=candidate.id and number_erased_at is null
      and exists(select 1 from private.evidence_cases c join private.evidence_artifacts a on a.case_id=c.id
        where c.id=candidate.case_id and c.status<>'open' and a.id=id_artifact_id
          and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp()))
      and not internal.evidence_fraud_held(candidate.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null);
    if found then numbers:=numbers+1; end if;
  end loop;

  delete from private.verification_phone_proofs where id in(select p.id from private.verification_phone_proofs p
    where p.revoked_at<statement_timestamp()-interval '30 days' order by p.revoked_at limit p_limit for update skip locked);
  get diagnostics proofs=row_count;
  delete from private.verification_phone_challenges where id in(select c.id from private.verification_phone_challenges c
    where c.expires_at<statement_timestamp()-interval '24 hours'
      and not exists(select 1 from private.verification_phone_proofs p where p.challenge_id=c.id)
    order by c.expires_at limit p_limit for update skip locked);
  get diagnostics challenges=row_count;

  -- Thirty days after closure: home area and terms acceptance go.
  delete from private.verification_localities where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
    order by x.closed_at limit p_limit);
  get diagnostics localities=row_count;
  delete from private.posting_terms_acceptances where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
    order by x.closed_at limit p_limit);
  get diagnostics acceptances=row_count;

  -- Five years after closure: the verification history of the account, once
  -- every file is deleted and no ban still depends on it.
  for candidate in
    select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '5 years'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and not exists(select 1 from private.evidence_artifacts a where a.owner_id=x.user_id and a.state<>'deleted')
      and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=x.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id)))
      and (exists(select 1 from private.evidence_cases c where c.subject_id=x.user_id
          and not exists(select 1 from private.decisions d where d.case_id=c.id and d.status='approved' and d.action='restrict_account'))
        or exists(select 1 from private.verification_phone_challenges p where p.owner_id=x.user_id))
    order by x.closed_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text,2408)) then continue; end if;
    -- Candidate discovery may precede other subjects' work in this batch.
    -- Recheck preservation rules under the same lock used by hold writers.
    if exists(select 1 from private.legal_holds h where h.subject_id=candidate.user_id and h.released_at is null)
      or exists(select 1 from private.evidence_cases c join private.evidence_fraud_holds h on h.case_id=c.id
        where c.subject_id=candidate.user_id and h.closed_at is null)
      or exists(select 1 from private.evidence_artifacts a where a.owner_id=candidate.user_id and a.state<>'deleted')
      or exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=candidate.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id))) then continue; end if;
    select coalesce(array_agg(c.id),'{}') into cases from private.evidence_cases c where c.subject_id=candidate.user_id;
    delete from private.identity_submission_names where owner_id=candidate.user_id;
    delete from private.verification_current_submissions where case_id=any(cases);
    delete from private.identity_review_proposals where submission_id in(select s.id from private.verification_identity_submissions s
      where s.owner_id=candidate.user_id) or decision_id in(select d.id from private.decisions d where d.case_id=any(cases));
    delete from private.identity_ban_proposal_requests where owner_id=candidate.user_id;
    delete from private.accepted_identity_facts where owner_id=candidate.user_id;
    delete from private.decisions where case_id=any(cases) and not (status='approved' and action='restrict_account');
    delete from private.evidence_access_log where case_id=any(cases);
    delete from private.evidence_fraud_holds where case_id=any(cases);
    delete from private.verification_identity_submissions where owner_id=candidate.user_id;
    delete from private.evidence_artifacts where owner_id=candidate.user_id;
    delete from private.evidence_cases c where c.id=any(cases) and not exists(select 1 from private.decisions d where d.case_id=c.id);
    delete from private.verification_phone_proofs where owner_id=candidate.user_id;
    delete from private.verification_phone_challenges where owner_id=candidate.user_id;
    delete from private.legal_holds where subject_id=candidate.user_id and released_at is not null;
    histories:=histories+1;
  end loop;
  return jsonb_build_object('identity_numbers_erased',numbers,'phone_proofs',proofs,'phone_challenges',challenges,
    'closed_account_localities',localities,'closed_account_terms_acceptances',acceptances,
    'closed_account_verification_histories',histories);
end;
$$;
revoke all on function internal.retention_verification(integer) from public,anon,authenticated,service_role;

-- Staff and audit records: two years; staff roles and legal holds five years
-- after they end. Approved restrictions stay while they keep an account out.
create function internal.retention_staff_records(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare access_log integer; decisions integer; moderation integer; queue_events integer; reports integer;
  restriction_cases integer:=0; fraud_holds integer; roles integer; holds integer; candidate record; due uuid[];
begin
  delete from private.evidence_access_log where id in(select l.id from private.evidence_access_log l
    where l.accessed_at<statement_timestamp()-interval '2 years' order by l.accessed_at limit p_limit);
  get diagnostics access_log=row_count;

  select coalesce(array_agg(x.id),'{}') into due from (select d.id from private.decisions d
    where d.status<>'proposed' and coalesce(d.approved_at,d.withdrawn_at)<statement_timestamp()-interval '2 years'
      and not (d.status='approved' and d.action='restrict_account')
      and not exists(select 1 from private.accepted_identity_facts f where f.decision_id=d.id)
      and not exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id)
      and not exists(select 1 from private.banned_identities b where b.decision_id=d.id)
    order by coalesce(d.approved_at,d.withdrawn_at) limit p_limit for update skip locked) x;
  delete from private.identity_review_proposals where decision_id=any(due);
  delete from private.identity_ban_proposal_requests where decision_id=any(due);
  delete from private.decisions where id=any(due);
  get diagnostics decisions=row_count;

  delete from private.moderation_log where id in(select m.id from private.moderation_log m
    where m.decided_at<statement_timestamp()-interval '2 years' order by m.decided_at limit p_limit);
  get diagnostics moderation=row_count;
  delete from private.queue_claim_events where id in(select e.id from private.queue_claim_events e
    where e.created_at<statement_timestamp()-interval '2 years' order by e.created_at limit p_limit);
  get diagnostics queue_events=row_count;
  delete from private.reports where id in(select r.id from private.reports r
    where r.status<>'open' and r.resolved_at<statement_timestamp()-interval '2 years'
    order by r.resolved_at limit p_limit for update skip locked);
  get diagnostics reports=row_count;

  -- Restriction cases opened only to browse identity history, never decided.
  for candidate in
    select c.id,c.subject_id from private.evidence_cases c
    where c.kind='restriction' and c.created_at<statement_timestamp()-interval '2 years'
      and (c.claim_expires_at is null or c.claim_expires_at<=clock_timestamp())
      and not exists(select 1 from private.decisions d where d.case_id=c.id)
      and not exists(select 1 from private.evidence_access_log l where l.case_id=c.id)
      and not exists(select 1 from private.evidence_artifacts a where a.case_id=c.id)
      and not exists(select 1 from private.evidence_fraud_holds h where h.case_id=c.id)
    order by c.created_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.subject_id::text,2408)) then continue; end if;
    delete from private.evidence_cases c where c.id=candidate.id
      and not exists(select 1 from private.decisions d where d.case_id=c.id)
      and not exists(select 1 from private.evidence_access_log l where l.case_id=c.id);
    restriction_cases:=restriction_cases+1;
  end loop;

  delete from private.evidence_fraud_holds where id in(select h.id from private.evidence_fraud_holds h
    where h.closed_at<statement_timestamp()-interval '2 years' order by h.closed_at limit p_limit for update skip locked);
  get diagnostics fraud_holds=row_count;
  delete from private.staff_roles where id in(select r.id from private.staff_roles r
    where r.revoked_at<statement_timestamp()-interval '5 years' order by r.revoked_at limit p_limit for update skip locked);
  get diagnostics roles=row_count;
  delete from private.legal_holds where id in(select h.id from private.legal_holds h
    where h.released_at<statement_timestamp()-interval '5 years' order by h.released_at limit p_limit for update skip locked);
  get diagnostics holds=row_count;
  return jsonb_build_object('evidence_access_log',access_log,'decisions',decisions,'moderation_log',moderation,
    'queue_claim_events',queue_events,'reports',reports,'restriction_cases',restriction_cases,
    'fraud_holds',fraud_holds,'staff_roles',roles,'legal_holds',holds);
end;
$$;
revoke all on function internal.retention_staff_records(integer) from public,anon,authenticated,service_role;

-- Money records: five years after the end of their tax year, children first.
create function internal.retention_commerce(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare provider_events integer; invoices integer; addon_windows integer; partner_events integer;
  commissions integer; acquisitions integer; sponsorships integer; trial_claims integer; activations integer;
  entitlements integer; payments integer;
begin
  delete from private.provider_events where id in(select e.id from private.provider_events e
    where internal.retention_tax_year_due(e.received_at) order by e.received_at limit p_limit);
  get diagnostics provider_events=row_count;
  delete from private.invoices where id in(select i.id from private.invoices i
    where internal.retention_tax_year_due(i.issued_at) order by i.issued_at limit p_limit);
  get diagnostics invoices=row_count;
  delete from private.post_addon_windows where id in(select w.id from private.post_addon_windows w
    where coalesce(w.revoked_at,w.ends_at)<=statement_timestamp()
      and internal.retention_tax_year_due(coalesce(w.revoked_at,w.ends_at)) order by w.ends_at limit p_limit);
  get diagnostics addon_windows=row_count;
  delete from private.partner_events where id in(select e.id from private.partner_events e
    where internal.retention_tax_year_due(e.created_at) order by e.created_at limit p_limit);
  get diagnostics partner_events=row_count;
  delete from private.partner_commissions where id in(select c.id from private.partner_commissions c
    where c.status in('paid','reversed') and internal.retention_tax_year_due(coalesce(c.reversed_at,c.paid_at))
      and not exists(select 1 from private.partner_events e where e.commission_id=c.id)
    order by c.created_at limit p_limit for update skip locked);
  get diagnostics commissions=row_count;
  delete from private.account_acquisitions where account_id in(select a.account_id from private.account_acquisitions a
    where internal.retention_tax_year_due(a.recorded_at) order by a.recorded_at limit p_limit);
  get diagnostics acquisitions=row_count;
  delete from private.organisation_sponsorships where id in(select s.id from private.organisation_sponsorships s
    where s.status in('ended','revoked') and internal.retention_tax_year_due(s.ended_at)
    order by s.ended_at limit p_limit for update skip locked);
  get diagnostics sponsorships=row_count;
  delete from private.post_trial_claims where post_id in(select c.post_id from private.post_trial_claims c
    where internal.retention_tax_year_due(coalesce(c.converted_at,c.claimed_at)) order by c.claimed_at limit p_limit);
  get diagnostics trial_claims=row_count;
  delete from private.post_activations where id in(select a.id from private.post_activations a
    where a.released_at is not null and internal.retention_tax_year_due(a.released_at)
      and not exists(select 1 from private.post_trial_claims c where c.converted_by_activation_id=a.id)
    order by a.released_at limit p_limit for update skip locked);
  get diagnostics activations=row_count;
  delete from private.entitlements where id in(select e.id from private.entitlements e
    where (e.status='revoked' or e.ends_at<=statement_timestamp())
      and internal.retention_tax_year_due(coalesce(e.ends_at,e.created_at))
      and not exists(select 1 from private.organisation_sponsorships s where s.entitlement_id=e.id)
      and not exists(select 1 from private.post_activations a where a.entitlement_id=e.id)
      and not exists(select 1 from private.post_trial_claims c where c.trial_entitlement_id=e.id)
      and not exists(select 1 from private.trial_identities t where t.entitlement_id=e.id)
    order by e.created_at limit p_limit for update skip locked);
  get diagnostics entitlements=row_count;
  delete from private.payments where id in(select p.id from private.payments p
    where p.status<>'pending' and internal.retention_tax_year_due(coalesce(p.completed_at,p.status_changed_at,p.created_at))
      and not exists(select 1 from private.entitlements e where e.payment_id=p.id)
      and not exists(select 1 from private.invoices i where i.payment_id=p.id)
      and not exists(select 1 from private.partner_commissions c where c.payment_id=p.id)
      and not exists(select 1 from private.post_addon_windows w where w.payment_id=p.id)
      and not exists(select 1 from private.provider_events e where e.payment_id=p.id)
    order by p.created_at limit p_limit for update skip locked);
  get diagnostics payments=row_count;
  return jsonb_build_object('provider_events',provider_events,'invoices',invoices,'addon_windows',addon_windows,
    'partner_events',partner_events,'partner_commissions',commissions,'account_acquisitions',acquisitions,
    'sponsorships',sponsorships,'post_trial_claims',trial_claims,'post_activations',activations,
    'entitlements',entitlements,'payments',payments);
end;
$$;
revoke all on function internal.retention_commerce(integer) from public,anon,authenticated,service_role;

-- Sign-in audit, outbox, price drafts and organisation records.
create function internal.retention_operations(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare auth_audit integer; outbox integer; drafts integer; invites integer; applications integer;
  notes integer; events integer;
begin
  delete from auth.audit_log_entries where id in(select a.id from auth.audit_log_entries a
    where a.created_at<statement_timestamp()-interval '30 days' order by a.created_at limit p_limit);
  get diagnostics auth_audit=row_count;
  delete from private.outbox_events where id in(select o.id from private.outbox_events o
    where o.processed_at<statement_timestamp()-interval '30 days' order by o.processed_at limit p_limit for update skip locked);
  get diagnostics outbox=row_count;
  delete from private.listing_price_drafts where owner_id in(select d.owner_id from private.listing_price_drafts d
    where d.expires_at<=statement_timestamp() order by d.expires_at limit p_limit for update skip locked);
  get diagnostics drafts=row_count;
  delete from private.organisation_invites where id in(select i.id from private.organisation_invites i
    where coalesce(i.accepted_at,i.revoked_at,i.expires_at)<statement_timestamp()-interval '30 days'
    order by i.created_at limit p_limit for update skip locked);
  get diagnostics invites=row_count;
  delete from private.organisation_applications where id in(select a.id from private.organisation_applications a
    where a.status in('approved','declined','withdrawn')
      and coalesce(a.decision_at,a.updated_at)<statement_timestamp()-interval '2 years'
    order by a.updated_at limit p_limit for update skip locked);
  get diagnostics applications=row_count;
  delete from private.organisation_notes where id in(select n.id from private.organisation_notes n
    where n.created_at<statement_timestamp()-interval '2 years' order by n.created_at limit p_limit);
  get diagnostics notes=row_count;
  delete from private.organisation_events where id in(select e.id from private.organisation_events e
    where e.created_at<statement_timestamp()-interval '2 years' order by e.created_at limit p_limit);
  get diagnostics events=row_count;
  return jsonb_build_object('auth_audit_log',auth_audit,'outbox_events',outbox,'listing_price_drafts',drafts,
    'organisation_invites',invites,'organisation_applications',applications,'organisation_notes',notes,
    'organisation_events',events);
end;
$$;
revoke all on function internal.retention_operations(integer) from public,anon,authenticated,service_role;

-- Server sweep, run daily. Object deletion stays with the evidence and media
-- cleanup claims, which need the storage worker.
create function internal.run_retention(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  result:=jsonb_build_object(
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$$;
revoke all on function internal.run_retention(integer) from public,anon,authenticated,service_role;
grant execute on function internal.run_retention(integer) to service_role;
create function api.run_retention(p_limit integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.run_retention(p_limit);
$$;
revoke all on function api.run_retention(integer) from public,anon,authenticated,service_role;
grant execute on function api.run_retention(integer) to service_role;

-- Reviewed rollback for updates/20261126053631_keep_for_periods.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the earlier bodies of internal.retention_tax_year_due,
-- internal.retention_privacy_requests, internal.retention_operations,
-- internal.retention_staff_records, internal.retention_verification and
-- internal.individual_slot_limit_guard byte for byte (same signatures, owners
-- and grants). Records the update's sweep already deleted stay deleted.
-- It refuses (55000) unless the six functions have this update's bodies (a
-- later update changed one: undo that update first).
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.retention_tax_year_due(timestamp with time zone)'),
      ('internal.retention_privacy_requests(integer)'),
      ('internal.retention_operations(integer)'),
      ('internal.retention_staff_records(integer)'),
      ('internal.retention_verification(integer)'),
      ('internal.individual_slot_limit_guard()')) v(sig)
  loop
    if shape not in (
        'internal.retention_tax_year_due(timestamp with time zone) e9e2b8fd093f12e0363d0fadf760ffec',
        'internal.retention_privacy_requests(integer) daec57205cdb25a6d30b767ecec59ffd',
        'internal.retention_operations(integer) a76b7c5b983c43c687d0abf47965f6f6',
        'internal.retention_staff_records(integer) 94c034a1b8e5812a357fca776bc0f2a8',
        'internal.retention_verification(integer) 56e4f71f0ad4ecb994e79ea9b0d695b8',
        'internal.individual_slot_limit_guard() 9a7d826f695d7e18d815b122d6c5afd2') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
end$$;

CREATE OR REPLACE FUNCTION internal.retention_tax_year_due(p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_at is not null and pg_catalog.make_timestamptz(
      extract(year from p_at at time zone 'Africa/Johannesburg')::integer
        + case when extract(month from p_at at time zone 'Africa/Johannesburg')>=3 then 1 else 0 end,
      3,1,0,0,0,'Africa/Johannesburg') + interval '5 years' <= statement_timestamp();
$function$;
revoke all on function internal.retention_tax_year_due(timestamp with time zone) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.retention_privacy_requests(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare minimised integer; purged integer;
begin
  with closed as (
    select r.id, coalesce(r.completed_at,
        (select max(e.occurred_at) from private.privacy_request_events e where e.request_id = r.id),
        r.created_at) as closed_at
    from private.privacy_requests r
    where r.status in ('completed', 'rejected') and r.minimised_at is null
  ), due as (
    select c.id from closed c
    where c.closed_at < statement_timestamp() - interval '30 days'
      or not exists (select 1 from private.privacy_notice_jobs j where j.request_id = c.id and j.delivered_at is null)
    order by c.closed_at limit p_limit
  )
  update private.privacy_requests r
    set requester_email = 'removed',
      requester_phone = 'not_provided', description = 'Removed after the request was closed.',
      minimised_at = statement_timestamp()
  from due where r.id = due.id;
  get diagnostics minimised = row_count;
  delete from private.privacy_requests r where r.id in (select x.id from private.privacy_requests x
    where x.minimised_at is not null
      -- Never while it explains an erasure that has not run (a rejection).
      and not exists (select 1 from private.account_erasure_requests l join private.account_erasures e on e.user_id = l.user_id
        where l.request_id = x.id and e.erased_at is null)
      and coalesce(x.completed_at, x.minimised_at) < statement_timestamp() - interval '5 years'
    order by x.minimised_at limit p_limit for update skip locked);
  get diagnostics purged = row_count;
  return jsonb_build_object('minimised', minimised, 'purged', purged);
end;
$function$;
revoke all on function internal.retention_privacy_requests(integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.retention_operations(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
revoke all on function internal.retention_operations(integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.retention_staff_records(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
revoke all on function internal.retention_staff_records(integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.retention_verification(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; numbers integer:=0; challenges integer; proofs integer; localities integer;
  acceptances integer; signup_acceptances integer; choice_events integer; histories integer:=0; cases uuid[];
  attempt_names integer; checks integer; ask_reasons integer; disclosures integer; mode_events integer; overdue integer;
begin
  -- The encrypted ID number goes with the selfie: once the selfie is deleted
  -- or due, unless its identity record is kept (internal.identity_record_kept).
  for candidate in
    select s.id,s.owner_id,s.case_id from private.verification_identity_submissions s
      join private.evidence_artifacts a on a.id=s.selfie_artifact_id
    where s.number_erased_at is null
      and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp())
      and not internal.identity_record_kept(s.id)
      and not internal.evidence_fraud_held(s.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=s.owner_id and h.released_at is null)
    order by s.owner_id,s.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    update private.verification_identity_submissions
      set number_ciphertext=null,number_iv=null,number_tag=null,number_erased_at=statement_timestamp()
    where id=candidate.id and number_erased_at is null
      and exists(select 1 from private.evidence_artifacts a where a.id=selfie_artifact_id
        and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp()))
      and not internal.identity_record_kept(candidate.id)
      and not internal.evidence_fraud_held(candidate.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null);
    if found then numbers:=numbers+1; end if;
  end loop;

  -- A failed attempt keeps only its fingerprint: the names it was made with go
  -- once its ID number is erased.
  delete from private.identity_submission_names where submission_id in(select s.id
    from private.verification_identity_submissions s join private.identity_submission_names n on n.submission_id=s.id
    where s.number_erased_at is not null
      and not exists(select 1 from private.accepted_identity_facts f where f.submission_id=s.id)
      and not internal.evidence_fraud_held(s.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=s.owner_id and h.released_at is null)
    order by s.number_erased_at,s.id limit p_limit);
  get diagnostics attempt_names=row_count;

  -- A check that did not lead to an accepted identity goes 7 days after it
  -- finished (the spending guard counts 7 days), once the partner's copy is
  -- deleted and no person is still to decide it, with its "ask a person"
  -- reason.
  delete from private.identity_checks where id in(select k.id from private.identity_checks k
    where k.status<>'started' and k.finished_at<statement_timestamp()-interval '7 days'
      and (k.session_id is null or k.provider_deleted_at is not null)
      and not exists(select 1 from private.accepted_identity_facts f where f.submission_id=k.submission_id)
      and not internal.identity_submission_waiting(k.submission_id)
      and not internal.evidence_fraud_held(k.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
    order by k.finished_at,k.id limit p_limit for update skip locked);
  get diagnostics checks=row_count;

  -- A closed account's "ask a person" reasons go with its selfie, 90 days
  -- after closure.
  update private.identity_checks set ask_reason=null where id in(select k.id from private.identity_checks k
    join private.account_closures x on x.user_id=k.owner_id
    where k.ask_reason is not null and x.evidence_delete_after<=statement_timestamp()
      and not internal.evidence_fraud_held(k.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
    order by x.closed_at,k.id limit p_limit for update of k skip locked);
  get diagnostics ask_reasons=row_count;

  -- Revoked phone proofs go 30 days after revocation, except the numbers an
  -- account with an accepted identity had verified when it closed: those stay
  -- with its identity record for the five-year sweep below.
  delete from private.verification_phone_proofs where id in(select p.id from private.verification_phone_proofs p
    where p.revoked_at<statement_timestamp()-interval '30 days'
      and not (exists(select 1 from private.account_closures x where x.user_id=p.owner_id and p.revoked_at>=x.closed_at)
        and exists(select 1 from private.accepted_identity_facts f where f.owner_id=p.owner_id))
    order by p.revoked_at limit p_limit for update skip locked);
  get diagnostics proofs=row_count;
  delete from private.verification_phone_challenges where id in(select c.id from private.verification_phone_challenges c
    where c.expires_at<statement_timestamp()-interval '24 hours'
      and not exists(select 1 from private.verification_phone_proofs p where p.challenge_id=c.id)
    order by c.expires_at limit p_limit for update skip locked);
  get diagnostics challenges=row_count;

  -- Thirty days after closure: home area and the consent records go
  -- (posting-terms acceptances, the sign-up Terms acceptance and the
  -- communication choice history, together). Each batch takes the oldest
  -- closed accounts that still hold such rows, so the sweep never stalls on
  -- accounts already cleared.
  delete from private.verification_localities where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.verification_localities l where l.owner_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics localities=row_count;
  delete from private.posting_terms_acceptances where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.posting_terms_acceptances a where a.owner_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics acceptances=row_count;
  delete from private.signup_terms_acceptances where account_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.signup_terms_acceptances a where a.account_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics signup_acceptances=row_count;
  delete from private.communication_choice_events where account_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.communication_choice_events e where e.account_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics choice_events=row_count;

  -- Five years after closure: the verification history of the account, once
  -- every file is deleted, no ban still depends on it and the partner holds
  -- no copy of its checks.
  for candidate in
    select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '5 years'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and not exists(select 1 from private.evidence_artifacts a where a.owner_id=x.user_id and a.state<>'deleted')
      and not exists(select 1 from private.identity_checks k where k.owner_id=x.user_id
        and k.session_id is not null and k.provider_deleted_at is null)
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
      or exists(select 1 from private.identity_checks k where k.owner_id=candidate.user_id
        and k.session_id is not null and k.provider_deleted_at is null)
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

  -- Authority-request logs: deleted 5 years after the search once every
  -- named account is gone and none has an open legal hold (a search that
  -- named nobody: 5 years after the search). An account is gone when it
  -- closed more than 5 years ago, or when its Auth user no longer exists and
  -- no erasure record is left either (the erasure record, kept 5 years after
  -- the erasure, otherwise dates the closure).
  delete from private.identity_disclosures where id in(select d.id from private.identity_disclosures d
    where d.opened_at<statement_timestamp()-interval '5 years'
      and coalesce((select bool_and((exists(select 1 from private.account_closures x where x.user_id=a.id
            and x.closed_at<statement_timestamp()-interval '5 years')
          or exists(select 1 from private.account_erasures e where e.user_id=a.id
            and e.closed_at<statement_timestamp()-interval '5 years')
          or (not exists(select 1 from auth.users u where u.id=a.id)
            and not exists(select 1 from private.account_erasures e where e.user_id=a.id)))
          and not exists(select 1 from private.legal_holds h where h.subject_id=a.id and h.released_at is null))
        from unnest(d.subject_ids) a(id)),true)
    order by d.opened_at,d.id limit p_limit for update skip locked);
  get diagnostics disclosures=row_count;
  -- The automatic ID check setting's change log: 5 years.
  delete from private.identity_check_mode_events where id in(select e.id from private.identity_check_mode_events e
    where e.changed_at<statement_timestamp()-interval '5 years'
    order by e.changed_at,e.id limit p_limit for update skip locked);
  get diagnostics mode_events=row_count;
  -- Overdue partner deletions (holds excepted): a stalled or failing deletion
  -- job shows here. Counted from dates the deletion job does not move (each
  -- claim pushes provider_delete_due 5 minutes ahead): a day after the 30
  -- days from the acceptance, otherwise 32 days after the check finished;
  -- and only while the deletion is due (a claim's lease is at most 5 minutes
  -- ahead) or, after an acceptance, never scheduled. A check waiting for a
  -- person has no due date and is not counted.
  select count(*) into overdue from private.identity_checks k
    cross join lateral (select max(f.reviewed_at) as accepted_at from private.accepted_identity_facts f
      where f.submission_id=k.submission_id) f
    where k.session_id is not null and k.provider_deleted_at is null
      and (k.provider_delete_due<=statement_timestamp()+interval '5 minutes'
        or (k.provider_delete_due is null and f.accepted_at is not null))
      and coalesce(f.accepted_at+interval '31 days',k.finished_at+interval '32 days')<statement_timestamp()
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
      and not internal.evidence_fraud_held(k.case_id);

  return jsonb_build_object('identity_numbers_erased',numbers,'phone_proofs',proofs,'phone_challenges',challenges,
    'closed_account_localities',localities,'closed_account_terms_acceptances',acceptances,
    'closed_account_signup_terms',signup_acceptances,'closed_account_communication_choices',choice_events,
    'closed_account_verification_histories',histories,'failed_attempt_names',attempt_names,
    'identity_checks',checks,'closed_account_ask_reasons',ask_reasons,'identity_disclosures',disclosures,
    'identity_check_mode_events',mode_events,'overdue_partner_deletions',overdue);
end;
$function$;
revoke all on function internal.retention_verification(integer) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.individual_slot_limit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
      return new;
    end if;
  end if;
  -- The audit trail of raised limits: a raise is only ever ended, once.
  if tg_op = 'DELETE' then
    raise exception 'slot limit history is retained' using errcode='23514';
  end if;
  if (to_jsonb(new) - array['revoked_at','revoked_by','revoke_reason'])
      is distinct from (to_jsonb(old) - array['revoked_at','revoked_by','revoke_reason'])
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'slot limit history is immutable; end the raise and grant a new one' using errcode='23514';
  end if;
  return new;
end;
$function$;
revoke all on function internal.individual_slot_limit_guard() from public,anon,authenticated,service_role;
commit;

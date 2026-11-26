-- Reviewed rollback for updates/20261126210022_business_check_retention.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the earlier body of internal.retention_verification byte for
-- byte (same signature, owner and grants) and the earlier check rule
-- frontend_business_checks_check1 (a visit check needs a visit address). The
-- rule is added NOT VALID and then validated only if every row meets it: a
-- decided visit check whose address the sweep already deleted would fail it,
-- and such a row keeps the rule unvalidated (new and changed rows are still
-- checked). Details and records the sweep already deleted stay deleted.
-- It refuses (55000) unless the function has this update's body (a later
-- update changed it: undo that update first).
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  select coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
    where p.oid=to_regprocedure('internal.retention_verification(integer)')),'absent') into shape;
  if shape<>'0121042302cb64dec7f7d1bcf81df0e0' then
    raise exception 'rollback precondition: internal.retention_verification(integer) % is not this update''s body', shape using errcode='55000';
  end if;
end$$;

alter table private.frontend_business_checks drop constraint frontend_business_checks_check1,
  add constraint frontend_business_checks_check1 check (seen_method<>'visit' or visit_address is not null) not valid;
do $$
begin
  alter table private.frontend_business_checks validate constraint frontend_business_checks_check1;
exception when check_violation then
  raise notice 'frontend_business_checks_check1 stays NOT VALID: a decided visit check has no address';
end$$;

CREATE OR REPLACE FUNCTION internal.retention_verification(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; numbers integer:=0; challenges integer; proofs integer; localities integer;
  acceptances integer; signup_acceptances integer; choice_events integer; histories integer:=0; cases uuid[];
  attempt_names integer; checks integer; ask_reasons integer; disclosures integer; mode_events integer; overdue integer;
  return_reasons integer;
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

  -- Reasons for returning an ID: 12 months after the return, unless a hold
  -- keeps them. Before the five-year sweep below: a kept return would stop
  -- its case from being deleted (the foreign key restricts).
  delete from private.verification_return_requests where id in(select r.id from private.verification_return_requests r
    join private.evidence_cases c on c.id=r.case_id
    where r.created_at<statement_timestamp()-interval '12 months'
      and not internal.evidence_fraud_held(r.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=c.subject_id and h.released_at is null)
    order by r.created_at limit p_limit for update of r skip locked);
  get diagnostics return_reasons=row_count;

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
    delete from private.verification_return_requests where case_id=any(cases);
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
    'identity_check_mode_events',mode_events,'overdue_partner_deletions',overdue,'return_reasons',return_reasons);
end;
$function$;
revoke all on function internal.retention_verification(integer) from public,anon,authenticated,service_role;

commit;

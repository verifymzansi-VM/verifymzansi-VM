-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.retention_verification(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; numbers integer:=0; challenges integer; proofs integer; localities integer;
  acceptances integer; signup_acceptances integer; choice_events integer; histories integer:=0; cases uuid[];
  attempt_names integer; checks integer; ask_reasons integer; disclosures integer; mode_events integer; overdue integer;
  return_reasons integer; business_details integer:=0; business_checks integer:=0; business_check private.frontend_business_checks;
  changed boolean;
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

  -- Business checks, as the Privacy page says. 30 days after the decision (a
  -- revocation is a later decision) the details go: the visit address, the
  -- visit report, photo locations, messages, the CIPC document records, the
  -- representative's email and the call notes. The sticker, its date and
  -- town, the outcome and the staff note stay. The check itself goes 12
  -- months after it ended (the sticker expired or was revoked, or the
  -- decision). A CIPC link sticker runs as long as its root business's
  -- sticker (frontend_current_cipc_stickers), so while it is the latest
  -- result of its business it ends when that root ends. Every reader shows
  -- the latest result of a business (approved or revoked, by decided_at then
  -- id; seen and CIPC apart), so results go oldest first: a result waits
  -- while an older one of the same business is left, and deleting one never
  -- changes what a business shows. The oldest is never kept waiting, and one
  -- that is not the latest ends at its own date, so every record goes. An
  -- open legal hold on the owner or fraud hold on the case keeps everything.
  for candidate in
    select x.id,x.owner_id from private.frontend_business_checks x
    where x.decided_at is not null
      and (greatest(coalesce(x.revoked_at,x.expires_at,x.decided_at),case when x.kind='cipc_link' then
          (select coalesce(root.revoked_at,root.expires_at) from private.frontend_cipc_latest_result l
            join private.frontend_cipc_latest_result root on root.business_id=l.linked_business_id and root.owner_id=l.owner_id
              and root.kind='cipc' and root.registration_number=l.registration_number
            where l.business_id=x.business_id and l.id=x.id and l.status='approved') end)<statement_timestamp()-interval '12 months'
          and (not (x.status='approved' or x.revoked_at is not null)
            or not exists(select 1 from private.frontend_business_checks o where o.business_id=x.business_id
              and (o.kind='seen')=(x.kind='seen') and (o.status='approved' or o.revoked_at is not null)
              and (o.decided_at,o.id)<(x.decided_at,x.id)))
        or (coalesce(x.revoked_at,x.decided_at)<statement_timestamp()-interval '30 days'
          and (x.visit_address is not null or x.visit_report is not null
            or exists(select 1 from private.frontend_business_seen_photos p where p.check_id=x.id
              and (p.latitude is not null or p.longitude is not null))
            or exists(select 1 from private.frontend_business_check_messages m where m.check_id=x.id)
            or exists(select 1 from private.frontend_cipc_documents d where d.check_id=x.id)
            or exists(select 1 from private.frontend_cipc_reviews r where r.check_id=x.id
              and (r.representative_email is not null or r.callback_record is not null)))))
      and not internal.evidence_fraud_held(x.id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.owner_id and h.released_at is null)
    order by x.decided_at,x.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    -- Revocations and hold writers take the same lock: read the check and the
    -- holds again under it.
    select * into business_check from private.frontend_business_checks x where x.id=candidate.id and x.decided_at is not null;
    if not found or internal.evidence_fraud_held(candidate.id)
      or exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null) then continue; end if;
    if greatest(coalesce(business_check.revoked_at,business_check.expires_at,business_check.decided_at),
        case when business_check.kind='cipc_link' then
          (select coalesce(root.revoked_at,root.expires_at) from private.frontend_cipc_latest_result l
            join private.frontend_cipc_latest_result root on root.business_id=l.linked_business_id and root.owner_id=l.owner_id
              and root.kind='cipc' and root.registration_number=l.registration_number
            where l.business_id=business_check.business_id and l.id=business_check.id and l.status='approved') end)
        <statement_timestamp()-interval '12 months'
      and (not (business_check.status='approved' or business_check.revoked_at is not null)
        or not exists(select 1 from private.frontend_business_checks o where o.business_id=business_check.business_id
          and (o.kind='seen')=(business_check.kind='seen') and (o.status='approved' or o.revoked_at is not null)
          and (o.decided_at,o.id)<(business_check.decided_at,business_check.id))) then
      delete from private.frontend_business_checks where id=candidate.id;
      business_checks:=business_checks+1;
    elsif coalesce(business_check.revoked_at,business_check.decided_at)<statement_timestamp()-interval '30 days' then
      update private.frontend_business_checks set visit_address=null,visit_report=null
        where id=candidate.id and (visit_address is not null or visit_report is not null);
      changed:=found;
      update private.frontend_business_seen_photos set latitude=null,longitude=null
        where check_id=candidate.id and (latitude is not null or longitude is not null);
      changed:=changed or found;
      delete from private.frontend_business_check_messages where check_id=candidate.id;
      changed:=changed or found;
      delete from private.frontend_cipc_documents where check_id=candidate.id;
      changed:=changed or found;
      update private.frontend_cipc_reviews set representative_email=null,callback_record=null
        where check_id=candidate.id and (representative_email is not null or callback_record is not null);
      if changed or found then business_details:=business_details+1; end if;
    end if;
  end loop;

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
    'identity_check_mode_events',mode_events,'overdue_partner_deletions',overdue,'return_reasons',return_reasons,
    'business_check_details',business_details,'business_checks',business_checks);
end;
$function$;
alter function internal.retention_verification(integer) owner to postgres;
revoke all on function internal.retention_verification(integer) from public;

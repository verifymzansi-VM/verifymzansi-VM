-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verification_decision_effect()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.verification_decision_effect() owner to postgres;
revoke all on function internal.verification_decision_effect() from public;

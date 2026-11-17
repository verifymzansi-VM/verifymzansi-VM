-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verification_decision_proposal_binding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.verification_decision_proposal_binding() owner to postgres;
revoke all on function internal.verification_decision_proposal_binding() from public;

-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.propose_verified_identity_ban(p_owner uuid, p_fact uuid, p_category text, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('decision:propose'); prior private.identity_ban_proposal_requests;
  case_id uuid; proposal jsonb;
begin
  if p_request is null or p_owner is null or p_fact is null or p_category is null
    or p_category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
    raise exception 'bound identity ban request required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  actor:=internal.staff_actor('decision:propose');
  if actor=p_owner then raise exception 'independent review required' using errcode='42501'; end if;
  select r.* into prior from private.identity_ban_proposal_requests r where r.id=p_request;
  if found then
    if (prior.owner_id,prior.fact_id,prior.category) is distinct from (p_owner,p_fact,p_category) then
      raise exception 'conflicting identity ban request' using errcode='PT409'; end if;
    return jsonb_build_object('decision_id',prior.decision_id,'reused',true);
  end if;
  -- Readiness revocation by a new owner upload never erases historical review.
  -- Staff deliberately select the immutable accepted fact being enforced.
  if not exists(select 1 from private.accepted_identity_facts f where f.id=p_fact and f.owner_id=p_owner) then
    raise exception 'reviewed subject identity required' using errcode='22023'; end if;
  insert into private.evidence_cases(subject_id,kind) values(p_owner,'restriction') returning id into case_id;
  proposal:=internal.propose_decision(case_id,1,'restrict_account',jsonb_build_object('identity_fact_id',p_fact,'identity_ban_category',p_category));
  insert into private.identity_ban_proposal_requests(id,owner_id,fact_id,category,decision_id)
    values(p_request,p_owner,p_fact,p_category,(proposal->>'decision_id')::uuid);
  return jsonb_build_object('decision_id',proposal->>'decision_id','reused',false);
end;
$function$;
alter function internal.propose_verified_identity_ban(uuid,uuid,text,uuid) owner to postgres;
revoke all on function internal.propose_verified_identity_ban(uuid,uuid,text,uuid) from public;
grant execute on function internal.propose_verified_identity_ban(uuid,uuid,text,uuid) to authenticated;

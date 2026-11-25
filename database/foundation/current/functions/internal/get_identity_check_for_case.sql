-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_identity_check_for_case(p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view'); c private.evidence_cases; k private.identity_checks;
begin
  if p_case is null then raise exception 'identity case required' using errcode='22023'; end if;
  select e.* into c from private.evidence_cases e where e.id=p_case and e.kind='kyc' and e.status='open'
    and e.claimed_by=actor and e.claim_expires_at>clock_timestamp() and e.subject_id<>actor;
  if not found then raise exception 'one current independent held case required' using errcode='42501'; end if;
  perform internal.staff_evidence_metadata(c.id,c.claim_generation::text,c.claim_nonce,'routine_review');
  select x.* into k from private.identity_checks x where x.case_id=c.id and x.status<>'unavailable'
    order by x.created_at desc,x.id desc limit 1;
  if k.id is null then return jsonb_build_object('check',null); end if;
  return jsonb_build_object('check',jsonb_build_object('id',k.id,'status',k.status,'submission_id',k.submission_id,
    'reasons',to_jsonb(k.reasons),'created_at',k.created_at,'finished_at',k.finished_at,'declined_at',k.declined_at,
    'asked_at',k.asked_at,'ask_reason',k.ask_reason,'consent_version',k.consent_version,'consented_at',k.consented_at));
end$function$;
alter function internal.get_identity_check_for_case(uuid) owner to postgres;
revoke all on function internal.get_identity_check_for_case(uuid) from public;
grant execute on function internal.get_identity_check_for_case(uuid) to authenticated;

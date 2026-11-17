-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.renew_evidence_claim(p_case_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.renew_evidence_claim(uuid,text,uuid) owner to postgres;
revoke all on function internal.renew_evidence_claim(uuid,text,uuid) from public;
grant execute on function internal.renew_evidence_claim(uuid,text,uuid) to authenticated;

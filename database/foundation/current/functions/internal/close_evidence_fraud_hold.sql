-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.close_evidence_fraud_hold(p_case_id uuid, p_hold_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.close_evidence_fraud_hold(uuid,uuid,text) owner to postgres;
revoke all on function internal.close_evidence_fraud_hold(uuid,uuid,text) from public;
grant execute on function internal.close_evidence_fraud_hold(uuid,uuid,text) to authenticated;

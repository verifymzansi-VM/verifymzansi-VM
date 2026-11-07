-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.place_evidence_fraud_hold(p_case_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.place_evidence_fraud_hold(uuid,text) owner to postgres;
revoke all on function internal.place_evidence_fraud_hold(uuid,text) from public;
grant execute on function internal.place_evidence_fraud_hold(uuid,text) to authenticated;

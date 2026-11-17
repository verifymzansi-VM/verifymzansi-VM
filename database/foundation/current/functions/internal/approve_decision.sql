-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.approve_decision(p_decision_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('decision:approve'); d private.decisions; c private.evidence_cases; case_id uuid; subject uuid;
begin
  select x.case_id,e.subject_id into case_id,subject from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision_id;
  if not found then raise exception 'decision not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id=case_id for update;
  select * into d from private.decisions x where x.id = p_decision_id for update;
  if not found or d.status <> 'proposed' then raise exception 'decision not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:approve');
  if actor in (d.proposed_by, c.subject_id) then
    raise exception 'a second, independent approver is required' using errcode = '42501';
  end if;
  if c.version is distinct from d.case_version or c.status <> 'open'
    or internal.evidence_case_snapshot(c.id) is distinct from d.reviewed_snapshot then
    raise exception 'case changed after proposal' using errcode = 'PT409';
  end if;
  update private.decisions set status = 'approved', approved_by = actor, approved_at = statement_timestamp()
  where id = d.id;
  update private.evidence_cases set status = 'decided', version = version + 1, claimed_by = null, claim_expires_at = null,claim_nonce=null
  where id = c.id;
  return jsonb_build_object('decision_id', d.id, 'status', 'approved');
end;
$function$;
alter function internal.approve_decision(uuid) owner to postgres;
revoke all on function internal.approve_decision(uuid) from public;
grant execute on function internal.approve_decision(uuid) to authenticated;

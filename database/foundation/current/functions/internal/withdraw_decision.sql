-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.withdraw_decision(p_decision_id uuid, p_expected_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('decision:withdraw'); subject uuid; case_id uuid;
  c private.evidence_cases; d private.decisions; reason text;
begin
  if p_expected_version is null or p_expected_version<1 then
    raise exception 'positive expected current case version required' using errcode='22023';
  end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  select x.case_id,e.subject_id into case_id,subject
    from private.decisions x join private.evidence_cases e on e.id=x.case_id where x.id=p_decision_id;
  if not found then raise exception 'proposal unavailable' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=case_id for update;
  select x.* into d from private.decisions x where x.id=p_decision_id for update;
  if not found then raise exception 'proposal unavailable' using errcode='22023'; end if;
  actor:=internal.staff_actor('decision:withdraw');
  if actor=c.subject_id then raise exception 'self-review is not allowed' using errcode='42501'; end if;
  if d.status='withdrawn' then
    if d.withdrawn_by=actor and d.withdrawal_reason=reason then
      return jsonb_build_object('decision_id',d.id,'status','withdrawn');
    end if;
    raise exception 'withdrawal already finalized by a different request' using errcode='PT409';
  end if;
  if d.status<>'proposed' then raise exception 'only pending proposals can be withdrawn' using errcode='22023'; end if;
  if c.version is distinct from p_expected_version then raise exception 'case changed since review' using errcode='PT409'; end if;
  if d.proposed_by<>actor and c.status='open' and c.version=d.case_version
    and internal.evidence_case_snapshot(c.id)=d.reviewed_snapshot then
    raise exception 'another reviewer may withdraw only an obsolete proposal' using errcode='42501';
  end if;
  update private.decisions set status='withdrawn',withdrawn_by=actor,withdrawn_at=clock_timestamp(),
    withdrawn_case_version=c.version,withdrawal_reason=reason where id=d.id;
  return jsonb_build_object('decision_id',d.id,'status','withdrawn');
end;
$function$;
alter function internal.withdraw_decision(uuid,integer,text) owner to postgres;
revoke all on function internal.withdraw_decision(uuid,integer,text) from public;
grant execute on function internal.withdraw_decision(uuid,integer,text) to authenticated;

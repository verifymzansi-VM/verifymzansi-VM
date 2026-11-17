-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.propose_decision(p_case_id uuid, p_expected_version integer, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('decision:propose'); c private.evidence_cases; d private.decisions; subject uuid;
begin
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 then
    raise exception 'positive expected case version required' using errcode='22023';
  end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id for update;
  if not found or c.status <> 'open' then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('decision:propose');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  if c.version <> p_expected_version then raise exception 'case changed since review' using errcode = 'PT409'; end if;
  insert into private.decisions (case_id, action, payload, case_version, reviewed_snapshot, proposed_by)
  values (c.id, p_action, coalesce(p_payload, '{}'), c.version, internal.evidence_case_snapshot(c.id), actor) returning * into d;
  return jsonb_build_object('decision_id', d.id, 'case_version', d.case_version);
end;
$function$;
alter function internal.propose_decision(uuid,integer,text,jsonb) owner to postgres;
revoke all on function internal.propose_decision(uuid,integer,text,jsonb) from public;
grant execute on function internal.propose_decision(uuid,integer,text,jsonb) to authenticated;

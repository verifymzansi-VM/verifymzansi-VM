-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_evidence_metadata(p_case_id uuid, p_claim_generation text, p_claim_nonce uuid, p_purpose text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('evidence:view'); c private.evidence_cases; items jsonb; ids uuid[]; subject uuid;
begin
  if p_purpose is null or p_purpose not in ('routine_review', 'override_review', 'appeal_review') then
    raise exception 'access purpose required' using errcode = '22023';
  end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id for update;
  if not found or c.status <> 'open' then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('evidence:view');
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select coalesce(jsonb_agg(jsonb_build_object('artifact_id', a.id, 'purpose', a.purpose, 'size_bytes', a.size_bytes,
      'uploaded_at', a.created_at) order by a.created_at), '[]'), coalesce(array_agg(a.id), '{}')
  into items, ids
  from private.evidence_artifacts a
  where a.case_id = c.id and a.state = 'clean'
    and (a.retain_until is null or a.retain_until > clock_timestamp());
  insert into private.evidence_access_log (staff_id, case_id, purpose,case_version,claim_generation,artifact_ids)
    values (actor,c.id,p_purpose,c.version,c.claim_generation,ids);
  return jsonb_build_object('case_id', c.id, 'version', c.version, 'artifacts', items);
end;
$function$;
alter function internal.staff_evidence_metadata(uuid,text,uuid,text) owner to postgres;
revoke all on function internal.staff_evidence_metadata(uuid,text,uuid,text) from public;
grant execute on function internal.staff_evidence_metadata(uuid,text,uuid,text) to authenticated;

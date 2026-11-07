-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_verification_queue(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim'); rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  select coalesce(jsonb_agg(row),'[]'::jsonb) into rows from(
    select jsonb_build_object('case_id',c.id,'version',c.version,'display_name',p.display_name,
      'submitted_at',s.created_at,'risk_score',s.risk_score,'decision_id',d.id,'proposed_by',d.proposed_by) as row
    from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
    join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
    join private.profiles p on p.account_id=c.subject_id
    left join private.decisions d on d.case_id=c.id and d.status='proposed' and d.action='approve_override'
    where c.kind='kyc' and c.status='open' and c.subject_id<>actor
    order by s.risk_score desc,s.created_at,c.id limit p_limit
  ) x;
  return rows;
end;
$function$;
alter function internal.staff_verification_queue(integer) owner to postgres;
revoke all on function internal.staff_verification_queue(integer) from public;
grant execute on function internal.staff_verification_queue(integer) to authenticated;

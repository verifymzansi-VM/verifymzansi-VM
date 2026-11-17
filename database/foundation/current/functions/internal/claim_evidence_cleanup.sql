-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_evidence_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare rows jsonb:='[]'::jsonb; candidate record; art private.evidence_artifacts; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  for candidate in select a.id,a.owner_id,a.case_id from private.evidence_artifacts a
    where ((a.state='intent' and a.created_at<statement_timestamp()-interval '1 hour')
      or (a.state in('uploaded','clean','rejected') and coalesce(a.retain_until,a.created_at+interval '90 days')<=statement_timestamp())
      or (a.state='cleanup_required' and coalesce(a.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp()))
      -- Filter holds before the batch limit, and check them again under locks.
      -- Otherwise a held prefix can starve every later unheld artifact forever.
      and not exists(select 1 from private.legal_holds h where h.subject_id=a.owner_id and h.released_at is null)
      and not internal.evidence_fraud_held(a.case_id)
    order by a.owner_id,a.case_id,a.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    perform c.id from private.evidence_cases c where c.id=candidate.case_id for update skip locked;
    if not found then continue; end if;
    select a.* into art from private.evidence_artifacts a where a.id=candidate.id for update skip locked;
    if not found then continue; end if;
    if exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null)
      or internal.evidence_fraud_held(art.case_id) then continue; end if;
    if not ((art.state='intent' and art.created_at<statement_timestamp()-interval '1 hour')
      or (art.state in('uploaded','clean','rejected') and coalesce(art.retain_until,art.created_at+interval '90 days')<=statement_timestamp())
      or (art.state='cleanup_required' and coalesce(art.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp())) then continue; end if;
    token:=pg_catalog.gen_random_uuid();
    update private.evidence_artifacts set state='cleanup_required',cleanup_token=token,cleanup_lease_until=statement_timestamp()+interval '5 minutes' where id=art.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('artifact_id',art.id,'object_key',art.object_key,'claim_token',token,'lease_until',statement_timestamp()+interval '5 minutes'));
  end loop;
  return rows;
end;
$function$;
alter function internal.claim_evidence_cleanup(integer) owner to postgres;
revoke all on function internal.claim_evidence_cleanup(integer) from public;
grant execute on function internal.claim_evidence_cleanup(integer) to service_role;

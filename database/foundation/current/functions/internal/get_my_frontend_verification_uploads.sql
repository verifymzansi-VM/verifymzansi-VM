-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_verification_uploads()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('artifact_id',x.artifact_id,'case_id',x.case_id,'purpose',x.purpose,
    'submitted_at',x.completed_at,'expires_at',x.expires_at)),'[]'::jsonb) into result from (
    select distinct on(r.purpose) r.* from private.frontend_verification_uploads r
    join private.evidence_artifacts a on a.id=r.artifact_id and a.owner_id=r.owner_id and a.case_id=r.case_id
    join private.evidence_cases c on c.id=r.case_id and c.subject_id=r.owner_id and c.status='open'
    where r.owner_id=actor and r.completed_at is not null and r.expires_at>clock_timestamp() and a.state='clean'
      and (a.retain_until is null or a.retain_until>clock_timestamp())
      and not exists(select 1 from private.verification_return_requests v where v.case_id=c.id and v.case_version>=r.case_version)
    order by r.purpose,r.created_at desc,r.request_id limit 2) x;
  perform internal.price_draft_actor();
  return result;
end$function$;
alter function internal.get_my_frontend_verification_uploads() owner to postgres;
revoke all on function internal.get_my_frontend_verification_uploads() from public;
grant execute on function internal.get_my_frontend_verification_uploads() to authenticated;

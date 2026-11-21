-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_scheduled_job_run(p_job text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only the jobs whose success the website decides.
  if p_job is null or p_job not in ('payment_checks', 'refund_check') then
    raise exception 'scheduled job recorded by the website required' using errcode='22023';
  end if;
  return internal.note_scheduled_job_run(p_job, true);
end
$function$;
alter function internal.record_scheduled_job_run(text) owner to postgres;
revoke all on function internal.record_scheduled_job_run(text) from public;
grant execute on function internal.record_scheduled_job_run(text) to service_role;

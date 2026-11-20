-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.note_scheduled_job_run(p_job text, p_result anyelement)
 RETURNS anyelement
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_job is null or not exists(select 1 from internal.scheduled_job_catalogue() c where c.job=p_job) then
    raise exception 'scheduled job required' using errcode='22023';
  end if;
  -- At most one write per job every 20 seconds; a later run moves the time on.
  if not exists(select 1 from private.scheduled_job_runs r
      where r.job=p_job and r.last_run_at>=clock_timestamp()-interval '20 seconds') then
    insert into private.scheduled_job_runs as r (job,last_run_at) values (p_job,clock_timestamp())
    on conflict (job) do update set last_run_at=greatest(r.last_run_at,excluded.last_run_at);
  end if;
  return p_result;
end
$function$;
alter function internal.note_scheduled_job_run(text,anyelement) owner to postgres;
revoke all on function internal.note_scheduled_job_run(text,anyelement) from public;
grant execute on function internal.note_scheduled_job_run(text,anyelement) to service_role;

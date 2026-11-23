-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('slot_renewals', internal.run_slot_renewals(p_limit)
    || jsonb_build_object('term_ending_notices', internal.queue_term_ending_notices(p_limit),
      'free_credit_reminders', internal.queue_free_credit_reminders(p_limit)));
$function$;
alter function api.run_slot_renewals(integer) owner to postgres;
revoke all on function api.run_slot_renewals(integer) from public;
grant execute on function api.run_slot_renewals(integer) to service_role;

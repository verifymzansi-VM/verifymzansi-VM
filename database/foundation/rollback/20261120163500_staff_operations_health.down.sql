-- Reviewed rollback for updates/20261120163500_staff_operations_health.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Websites deployed before the
-- update work without it; the website that reads the staff operations page
-- then shows "could not be loaded" on that page (switched off until launch).
-- The rollback puts back the seventeen scheduled job commands byte for byte,
-- and drops api.get_staff_operations_health, its internal twin,
-- internal.note_scheduled_job_run, internal.scheduled_job_catalogue and
-- private.scheduled_job_runs (with the recorded run times; nothing else).
begin;
set local lock_timeout='5s';

do $$begin
  if to_regclass('private.scheduled_job_runs') is null
    or to_regprocedure('api.get_staff_operations_health()') is null
    or to_regprocedure('internal.note_scheduled_job_run(text,anyelement)') is null then
    raise exception 'rollback precondition: the staff operations health update is not applied' using errcode='55000';
  end if;
end$$;

-- The job commands as they were before the update.
CREATE OR REPLACE FUNCTION api.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.run_slot_renewals(p_limit);
$function$;
alter function api.run_slot_renewals(integer) owner to postgres;
revoke all on function api.run_slot_renewals(integer) from public;
grant execute on function api.run_slot_renewals(integer) to service_role;

CREATE OR REPLACE FUNCTION api.run_post_lifecycle(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.run_post_lifecycle(p_limit);
$function$;
alter function api.run_post_lifecycle(integer) owner to postgres;
revoke all on function api.run_post_lifecycle(integer) from public;
grant execute on function api.run_post_lifecycle(integer) to service_role;

CREATE OR REPLACE FUNCTION api.sweep_sponsorships(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.sweep_sponsorships(p_limit);
$function$;
alter function api.sweep_sponsorships(integer) owner to postgres;
revoke all on function api.sweep_sponsorships(integer) from public;
grant execute on function api.sweep_sponsorships(integer) to service_role;

CREATE OR REPLACE FUNCTION api.purge_expired_inbox(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.purge_expired_inbox(p_limit);
$function$;
alter function api.purge_expired_inbox(integer) owner to postgres;
revoke all on function api.purge_expired_inbox(integer) from public;
grant execute on function api.purge_expired_inbox(integer) to service_role;

CREATE OR REPLACE FUNCTION api.reconcile_intro_trials(p_limit integer DEFAULT 20)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reconcile_intro_trials(p_limit);
$function$;
alter function api.reconcile_intro_trials(integer) owner to postgres;
revoke all on function api.reconcile_intro_trials(integer) from public;
grant execute on function api.reconcile_intro_trials(integer) to service_role;

CREATE OR REPLACE FUNCTION api.approve_due_commissions(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.approve_due_commissions(p_limit);
$function$;
alter function api.approve_due_commissions(integer) owner to postgres;
revoke all on function api.approve_due_commissions(integer) from public;
grant execute on function api.approve_due_commissions(integer) to service_role;

CREATE OR REPLACE FUNCTION api.expire_waiting_bank_transfers(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.expire_waiting_bank_transfers(p_limit);
$function$;
alter function api.expire_waiting_bank_transfers(integer) owner to postgres;
revoke all on function api.expire_waiting_bank_transfers(integer) from public;
grant execute on function api.expire_waiting_bank_transfers(integer) to service_role;

CREATE OR REPLACE FUNCTION api.void_ended_package_add_invoices(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.void_ended_package_add_invoices(p_limit);
$function$;
alter function api.void_ended_package_add_invoices(integer) owner to postgres;
revoke all on function api.void_ended_package_add_invoices(integer) from public;
grant execute on function api.void_ended_package_add_invoices(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.claim_supported_notification_outbox(p_supported_kinds,p_limit)$function$;
alter function api.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function api.claim_supported_notification_outbox(text[],integer) from public;
grant execute on function api.claim_supported_notification_outbox(text[],integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_payment_alerts(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_payment_alerts(p_limit);
$function$;
alter function api.claim_payment_alerts(integer) owner to postgres;
revoke all on function api.claim_payment_alerts(integer) from public;
grant execute on function api.claim_payment_alerts(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_frontend_privacy_notice()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.claim_frontend_privacy_notice()$function$;
alter function api.claim_frontend_privacy_notice() owner to postgres;
revoke all on function api.claim_frontend_privacy_notice() from public;
grant execute on function api.claim_frontend_privacy_notice() to service_role;

CREATE OR REPLACE FUNCTION api.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.run_retention(p_limit);
$function$;
alter function api.run_retention(integer) owner to postgres;
revoke all on function api.run_retention(integer) from public;
grant execute on function api.run_retention(integer) to service_role;

CREATE OR REPLACE FUNCTION api.purge_frontend_form_drafts(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.purge_frontend_form_drafts(p_limit)
$function$;
alter function api.purge_frontend_form_drafts(integer) owner to postgres;
revoke all on function api.purge_frontend_form_drafts(integer) from public;
grant execute on function api.purge_frontend_form_drafts(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_evidence_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_evidence_cleanup(p_limit);
$function$;
alter function api.claim_evidence_cleanup(integer) owner to postgres;
revoke all on function api.claim_evidence_cleanup(integer) from public;
grant execute on function api.claim_evidence_cleanup(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_media_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_media_cleanup(p_limit);
$function$;
alter function api.claim_media_cleanup(integer) owner to postgres;
revoke all on function api.claim_media_cleanup(integer) from public;
grant execute on function api.claim_media_cleanup(integer) to service_role;

CREATE OR REPLACE FUNCTION api.expire_stale_checkouts(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.expire_stale_checkouts(p_limit);
$function$;
alter function api.expire_stale_checkouts(integer) owner to postgres;
revoke all on function api.expire_stale_checkouts(integer) from public;
grant execute on function api.expire_stale_checkouts(integer) to service_role;

CREATE OR REPLACE FUNCTION api.reconcile_ozow_refunds(p_refunds jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reconcile_ozow_refunds(p_refunds);
$function$;
alter function api.reconcile_ozow_refunds(jsonb) owner to postgres;
revoke all on function api.reconcile_ozow_refunds(jsonb) from public;
grant execute on function api.reconcile_ozow_refunds(jsonb) to service_role;

drop function api.get_staff_operations_health();
drop function internal.get_staff_operations_health();
drop function internal.note_scheduled_job_run(text,anyelement);
drop function internal.scheduled_job_catalogue();
drop table private.scheduled_job_runs;

notify pgrst,'reload schema';
commit;

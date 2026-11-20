-- Reviewed rollback for updates/20261120163500_staff_operations_health.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Websites deployed before the
-- update work without it; the website that reads the staff operations page
-- then shows "could not be loaded" on that page (switched off until launch),
-- and the payment jobs log that their run could not be recorded.
-- The rollback puts back the fifteen scheduled job commands byte for byte,
-- and drops api.get_staff_operations_health, api.record_scheduled_job_run,
-- their internal twins, internal.note_scheduled_job_run,
-- internal.scheduled_job_catalogue and private.scheduled_job_runs (with the
-- recorded run times; nothing else).
-- It refuses (55000) unless every function it replaces or drops still has the
-- update's body and no other function calls internal.note_scheduled_job_run,
-- so a later update that changed one of them is never undone silently.
begin;
set local lock_timeout='5s';

do $$
declare drift text; callers text;
begin
  if to_regclass('private.scheduled_job_runs') is null
    or to_regprocedure('api.get_staff_operations_health()') is null
    or to_regprocedure('internal.note_scheduled_job_run(text,anyelement)') is null then
    raise exception 'rollback precondition: the staff operations health update is not applied' using errcode='55000';
  end if;
  select string_agg(v.sig, ', ' order by v.sig) into drift
  from (values
    ('api.run_slot_renewals(integer)', 'b78dc0ac9c98fd46da971c17a3f07a43'),
    ('api.run_post_lifecycle(integer)', 'fdc95d2c2e7d7af8411c18e809370cac'),
    ('api.sweep_sponsorships(integer)', '4368e3adf7f855a1e677ccb97ad4bb4e'),
    ('api.purge_expired_inbox(integer)', '93aaff6a107125239a173cf5c2c8a2ba'),
    ('api.reconcile_intro_trials(integer)', 'd0b4dee427e3a6aa0e9be5587d70cae6'),
    ('api.approve_due_commissions(integer)', '44f02582e6b1486ec52dbfd627b77f6f'),
    ('api.expire_waiting_bank_transfers(integer)', '0b4654bc20b9c08641d06a1780bafec8'),
    ('api.void_ended_package_add_invoices(integer)', '10c5e610ad372770fce06e5feaf569e3'),
    ('api.claim_supported_notification_outbox(text[],integer)', 'b0dd2ef0c8fa21aa0c07a3b0f530e90e'),
    ('api.claim_payment_alerts(integer)', '524e92211a80e57582a04785bd94df5e'),
    ('api.claim_frontend_privacy_notice()', '05ad93776187bff58e72d43c5f6be3d0'),
    ('api.run_retention(integer)', 'af45cfe715c12bc7e772a7ef3ecf3475'),
    ('api.purge_frontend_form_drafts(integer)', 'a41ca813762071f9b0b963d54cf3155a'),
    ('api.claim_evidence_cleanup(integer)', '9d3d5b7f73ee0100006f71657ff6f79c'),
    ('api.claim_media_cleanup(integer)', '5b146b7b0c1f348bf1713c0f23bfd901'),
    ('api.record_scheduled_job_run(text)', '030f074f26e1e23c13a00e3e30f0fbd8'),
    ('api.get_staff_operations_health()', '0d522526c382954f585b476ecdb25fac'),
    ('internal.record_scheduled_job_run(text)', '677e30342cfe57d26c45dc58ce7b5ee8'),
    ('internal.get_staff_operations_health()', 'c7be6d6d742cbb8cdac138b0db778bb5'),
    ('internal.note_scheduled_job_run(text,anyelement)', '783b802513659a9ad0723c5ad59e1ee5'),
    ('internal.scheduled_job_catalogue()', '249bf575fc434934aafe0f0a68ea30dc')
  ) v(sig, updated)
  where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig))
    is distinct from v.updated;
  if drift is not null then
    raise exception 'rollback precondition: changed since the update: %', drift using errcode='55000';
  end if;
  -- Only the fifteen job commands and internal.record_scheduled_job_run call
  -- the helper this rollback drops.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into callers
  from pg_proc p
  where p.prosrc like '%note_scheduled_job_run%'
    and p.oid not in (
      to_regprocedure('api.run_slot_renewals(integer)'),
      to_regprocedure('api.run_post_lifecycle(integer)'),
      to_regprocedure('api.sweep_sponsorships(integer)'),
      to_regprocedure('api.purge_expired_inbox(integer)'),
      to_regprocedure('api.reconcile_intro_trials(integer)'),
      to_regprocedure('api.approve_due_commissions(integer)'),
      to_regprocedure('api.expire_waiting_bank_transfers(integer)'),
      to_regprocedure('api.void_ended_package_add_invoices(integer)'),
      to_regprocedure('api.claim_supported_notification_outbox(text[],integer)'),
      to_regprocedure('api.claim_payment_alerts(integer)'),
      to_regprocedure('api.claim_frontend_privacy_notice()'),
      to_regprocedure('api.run_retention(integer)'),
      to_regprocedure('api.purge_frontend_form_drafts(integer)'),
      to_regprocedure('api.claim_evidence_cleanup(integer)'),
      to_regprocedure('api.claim_media_cleanup(integer)'),
      to_regprocedure('internal.record_scheduled_job_run(text)'));
  if callers is not null then
    raise exception 'rollback precondition: other functions call internal.note_scheduled_job_run: %', callers using errcode='55000';
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

drop function api.get_staff_operations_health();
drop function internal.get_staff_operations_health();
drop function api.record_scheduled_job_run(text);
drop function internal.record_scheduled_job_run(text);
drop function internal.note_scheduled_job_run(text,anyelement);
drop function internal.scheduled_job_catalogue();
drop table private.scheduled_job_runs;

notify pgrst,'reload schema';
commit;

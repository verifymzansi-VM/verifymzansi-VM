-- Reviewed rollback for updates/20261113085340_retire_old_staff_reversal_commands.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. No website release needs it: the
-- releases since 20261113021223_staff_payment_fixes.sql call the replacement
-- commands only.
--
-- It puts back the three earlier API commands exactly as they were (one-line
-- wrappers, callable by signed-in accounts; their internal functions still
-- check the staff capability and recent authenticator code) and the execute
-- grant of the three internal functions behind them to authenticated. It
-- changes no data. Running it on a database without the update changes
-- nothing.
begin;
set local lock_timeout='5s';

do $$
begin
  if to_regprocedure('internal.record_frontend_staff_payment_reversal(uuid,text,text)') is null
    or to_regprocedure('internal.get_frontend_staff_payments(integer,text)') is null
    or to_regprocedure('internal.record_staff_slot_reversal(uuid,text,text)') is null then
    raise exception 'rollback precondition: an internal staff payment function is missing'
      using errcode='55000';
  end if;
end$$;

grant execute on function internal.record_frontend_staff_payment_reversal(uuid,text,text) to authenticated;
grant execute on function internal.get_frontend_staff_payments(integer,text) to authenticated;
grant execute on function internal.record_staff_slot_reversal(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.record_frontend_staff_payment_reversal(p_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_frontend_staff_payment_reversal(p_id,p_kind,p_reason)
$function$;
alter function api.record_frontend_staff_payment_reversal(uuid,text,text) owner to postgres;
revoke all on function api.record_frontend_staff_payment_reversal(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function api.record_frontend_staff_payment_reversal(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.record_staff_slot_reversal(p_line_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_slot_reversal(p_line_id, p_kind, p_reason);
$function$;
alter function api.record_staff_slot_reversal(uuid,text,text) owner to postgres;
revoke all on function api.record_staff_slot_reversal(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function api.record_staff_slot_reversal(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.get_frontend_staff_payments(p_page integer, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_frontend_staff_payments(p_page,p_status)
$function$;
alter function api.get_frontend_staff_payments(integer,text) owner to postgres;
revoke all on function api.get_frontend_staff_payments(integer,text) from public, anon, authenticated, service_role;
grant execute on function api.get_frontend_staff_payments(integer,text) to authenticated;

commit;

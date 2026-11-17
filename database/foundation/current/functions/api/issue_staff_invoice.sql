-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.issue_staff_invoice(p_account_email text, p_term_days integer, p_slots integer, p_due_days integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.issue_staff_invoice(p_account_email, p_term_days, p_slots, p_due_days, p_reason, p_request_id);
$function$;
alter function api.issue_staff_invoice(text,integer,integer,integer,text,uuid) owner to postgres;
revoke all on function api.issue_staff_invoice(text,integer,integer,integer,text,uuid) from public;
grant execute on function api.issue_staff_invoice(text,integer,integer,integer,text,uuid) to authenticated;

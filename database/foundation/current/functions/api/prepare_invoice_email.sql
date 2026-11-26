-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.prepare_invoice_email(p_invoice_id uuid, p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.prepare_invoice_email(p_invoice_id, p_token_hash);
$function$;
alter function api.prepare_invoice_email(uuid,text) owner to postgres;
revoke all on function api.prepare_invoice_email(uuid,text) from public;
grant execute on function api.prepare_invoice_email(uuid,text) to service_role;

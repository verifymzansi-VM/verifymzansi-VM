-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_invoice_by_link(p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_invoice(null, coalesce(p_token_hash, ''));
$function$;
alter function api.get_invoice_by_link(text) owner to postgres;
revoke all on function api.get_invoice_by_link(text) from public;
grant execute on function api.get_invoice_by_link(text) to service_role;

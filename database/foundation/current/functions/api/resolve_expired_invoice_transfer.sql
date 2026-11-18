-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.resolve_expired_invoice_transfer(p_transfer_id uuid, p_resolution text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.resolve_expired_invoice_transfer(p_transfer_id, p_resolution, p_reason);
$function$;
alter function api.resolve_expired_invoice_transfer(uuid,text,text) owner to postgres;
revoke all on function api.resolve_expired_invoice_transfer(uuid,text,text) from public;
grant execute on function api.resolve_expired_invoice_transfer(uuid,text,text) to authenticated;

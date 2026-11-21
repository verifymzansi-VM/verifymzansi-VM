-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.open_identity_disclosure(p_request_type text, p_reference text, p_requested_by text, p_request_date text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.open_identity_disclosure(p_request_type,p_reference,p_requested_by,p_request_date,p_reason,p_lookup_kind,p_lookup_value,p_attested);
$function$;
alter function api.open_identity_disclosure(text,text,text,text,text,text,text,boolean) owner to postgres;
revoke all on function api.open_identity_disclosure(text,text,text,text,text,text,text,boolean) from public;
grant execute on function api.open_identity_disclosure(text,text,text,text,text,text,text,boolean) to authenticated;

-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.resolve_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid, p_outcome text, p_note text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.resolve_report(p_report_id, p_claim_generation, p_claim_nonce, p_outcome, p_note);
$function$;
alter function api.resolve_report(uuid,text,uuid,text,text) owner to postgres;
revoke all on function api.resolve_report(uuid,text,uuid,text,text) from public;
grant execute on function api.resolve_report(uuid,text,uuid,text,text) to authenticated;

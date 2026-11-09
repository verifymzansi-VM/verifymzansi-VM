-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.accept_posting_terms(p_version text, p_document_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.accept_posting_terms(p_version,p_document_hash);
$function$;
alter function api.accept_posting_terms(text,text) owner to postgres;
revoke all on function api.accept_posting_terms(text,text) from public;
grant execute on function api.accept_posting_terms(text,text) to authenticated;

-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_current_posting_terms()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('version',v.version,'document_hash',v.document_hash,
    'document_path','/terms/versions/'||v.version)
  from private.posting_terms_current c join private.posting_terms_versions v using(version)
  where c.singleton;
$function$;
alter function internal.get_current_posting_terms() owner to postgres;
revoke all on function internal.get_current_posting_terms() from public;
grant execute on function internal.get_current_posting_terms() to anon;
grant execute on function internal.get_current_posting_terms() to authenticated;

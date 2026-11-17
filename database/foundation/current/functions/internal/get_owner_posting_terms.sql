-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_owner_posting_terms()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); document jsonb; accepted timestamptz;
begin
  document:=internal.get_current_posting_terms();
  if document is null then return null; end if;
  select a.accepted_at into accepted from private.posting_terms_acceptances a
    where a.owner_id=actor and a.version=document->>'version'
      and a.document_hash=document->>'document_hash';
  perform internal.price_draft_actor();
  return document||jsonb_build_object('accepted_at',accepted);
end;
$function$;
alter function internal.get_owner_posting_terms() owner to postgres;
revoke all on function internal.get_owner_posting_terms() from public;
grant execute on function internal.get_owner_posting_terms() to authenticated;

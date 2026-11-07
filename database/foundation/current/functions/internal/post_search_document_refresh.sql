-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_search_document_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  new.document := internal.post_search_document(new.title, new.summary, new.category_key,
    new.activity_key, new.locality_label);
  -- Plain lower-case text for typo-tolerant trigram matching.
  new.search_text := lower(normalize(concat_ws(' ', new.title,
    (select c.label from private.categories c where c.key = new.category_key),
    (select a.label from private.category_activities a
      where a.category_key = new.category_key and a.key = new.activity_key),
    new.locality_label, new.summary), NFKC));
  return new;
end;
$function$;
alter function internal.post_search_document_refresh() owner to postgres;
revoke all on function internal.post_search_document_refresh() from public;

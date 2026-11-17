-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_search_document(p_title text, p_summary text, p_category text, p_activity text, p_locality text)
 RETURNS tsvector
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select setweight(to_tsvector('simple', coalesce(p_title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce((select c.label from private.categories c where c.key = p_category), '')
      || ' ' || coalesce((select a.label from private.category_activities a
        where a.category_key = p_category and a.key = p_activity), '')
      || ' ' || coalesce(p_locality, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(p_summary, '')), 'C');
$function$;
alter function internal.post_search_document(text,text,text,text,text) owner to postgres;
revoke all on function internal.post_search_document(text,text,text,text,text) from public;

-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_hidden_sample_posts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('slugs',
    coalesce((select jsonb_agg(h.slug order by h.slug) from private.hidden_sample_posts h), '[]'::jsonb));
$function$;
alter function internal.get_hidden_sample_posts() owner to postgres;
revoke all on function internal.get_hidden_sample_posts() from public;
grant execute on function internal.get_hidden_sample_posts() to anon;
grant execute on function internal.get_hidden_sample_posts() to authenticated;

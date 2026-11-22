-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.give_free_credit(p_email text, p_posts integer, p_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.give_free_credit(p_email, p_posts, p_days, p_reason);
$function$;
alter function api.give_free_credit(text,integer,integer,text) owner to postgres;
revoke all on function api.give_free_credit(text,integer,integer,text) from public;
grant execute on function api.give_free_credit(text,integer,integer,text) to authenticated;

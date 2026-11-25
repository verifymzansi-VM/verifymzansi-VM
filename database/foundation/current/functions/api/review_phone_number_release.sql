-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.review_phone_number_release(p_phone text, p_approve boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.review_phone_number_release(p_phone,p_approve)$function$;
alter function api.review_phone_number_release(text,boolean) owner to postgres;
revoke all on function api.review_phone_number_release(text,boolean) from public;
grant execute on function api.review_phone_number_release(text,boolean) to authenticated;

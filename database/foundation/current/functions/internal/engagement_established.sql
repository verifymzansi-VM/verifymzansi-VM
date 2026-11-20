-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.engagement_established(p_account uuid, p_device_issued_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(p_device_issued_at < statement_timestamp() - interval '24 hours', false)
    or (p_account is not null and exists(select 1 from auth.users u
      join private.current_account_access a on a.id = u.id
      where u.id = p_account and u.created_at < statement_timestamp() - interval '7 days'));
$function$;
alter function internal.engagement_established(uuid,timestamp with time zone) owner to postgres;
revoke all on function internal.engagement_established(uuid,timestamp with time zone) from public;

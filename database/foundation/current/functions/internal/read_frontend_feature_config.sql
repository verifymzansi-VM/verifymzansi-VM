-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.read_frontend_feature_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('key',f.key,'enabled',f.mode<>'off','mode',f.mode,
    'rollout_percent',f.rollout_percent,'allowlist_roles',f.allowlist_roles) order by f.key),'[]'::jsonb) from private.frontend_feature_flags f;
$function$;
alter function internal.read_frontend_feature_config() owner to postgres;
revoke all on function internal.read_frontend_feature_config() from public;
grant execute on function internal.read_frontend_feature_config() to service_role;

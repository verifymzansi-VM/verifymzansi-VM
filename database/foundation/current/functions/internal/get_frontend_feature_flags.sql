-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_feature_flags()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('feature_flag:toggle');rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'key',f.key,'enabled',f.mode<>'off','description',f.description,
    'mode',f.mode,'rollout_percent',f.rollout_percent,'allowlist_roles',f.allowlist_roles,'revision',f.revision,
    'updated_at',f.updated_at,'updated_reason',f.updated_reason) order by f.key),'[]'::jsonb) into rows from private.frontend_feature_flags f;
  perform internal.staff_actor('feature_flag:toggle');return jsonb_build_object('account_id',actor,'flags',rows);
end$function$;
alter function internal.get_frontend_feature_flags() owner to postgres;
revoke all on function internal.get_frontend_feature_flags() from public;
grant execute on function internal.get_frontend_feature_flags() to authenticated;

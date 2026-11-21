-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.mark_identity_check_provider_deleted(p_check uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks;
begin
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if not found or k.session_id is null or k.status='started' then
    raise exception 'finished identity check with a session required' using errcode='PT409'; end if;
  if k.provider_deleted_at is not null then
    return jsonb_build_object('check_id',k.id,'provider_deleted_at',k.provider_deleted_at,'reused',true); end if;
  update private.identity_checks set provider_deleted_at=clock_timestamp(),provider_delete_due=null where id=k.id returning * into k;
  return jsonb_build_object('check_id',k.id,'provider_deleted_at',k.provider_deleted_at,'reused',false);
end$function$;
alter function internal.mark_identity_check_provider_deleted(uuid) owner to postgres;
revoke all on function internal.mark_identity_check_provider_deleted(uuid) from public;
grant execute on function internal.mark_identity_check_provider_deleted(uuid) to service_role;

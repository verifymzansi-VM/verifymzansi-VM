-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.mark_media_deleted(p_object_id uuid, p_claim_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_claim_token is null then raise exception 'cleanup claim token required' using errcode='22023'; end if;
  if exists(select 1 from private.media_objects where id=p_object_id and state='deleted' and cleanup_token=p_claim_token) then return true; end if;
  update private.media_objects set state = 'deleted', deleted_at = statement_timestamp()
  where id = p_object_id and state = 'cleanup_required' and cleanup_token=p_claim_token
    and cleanup_lease_until>statement_timestamp();
  if not found then raise exception 'object is not awaiting deletion' using errcode = '22023'; end if;
  return true;
end;
$function$;
alter function internal.mark_media_deleted(uuid,uuid) owner to postgres;
revoke all on function internal.mark_media_deleted(uuid,uuid) from public;
grant execute on function internal.mark_media_deleted(uuid,uuid) to service_role;

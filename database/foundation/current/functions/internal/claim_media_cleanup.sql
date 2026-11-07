-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_media_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare rows jsonb := '[]'::jsonb; obj private.media_objects; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'limit 1 to 500' using errcode = '22023'; end if;
  for obj in
    select m.* from private.media_objects m
    where (m.state = 'intent' and m.created_at < statement_timestamp() - interval '1 hour')
       or m.state = 'rejected'
       or (m.state = 'ready' and coalesce(greatest(m.created_at, m.unlinked_at), m.created_at)
             < statement_timestamp() - interval '24 hours'
           and not internal.media_object_in_use(m.id))
       or (m.state = 'cleanup_required' and coalesce(m.cleanup_lease_until,'-infinity'::timestamptz) <= statement_timestamp())
    order by m.created_at limit p_limit
    for update skip locked
  loop
    -- A separate statement sees links committed before this object lock was acquired.
    if internal.media_object_in_use(obj.id) then continue; end if;
    token := pg_catalog.gen_random_uuid();
    update private.media_objects set state='cleanup_required',cleanup_token=token,
      cleanup_lease_until=statement_timestamp()+interval '5 minutes',cleanup_attempt=cleanup_attempt+1
      where id=obj.id;
    rows := rows || jsonb_build_array(jsonb_build_object('object_id',obj.id,'object_key',obj.object_key,
      'claim_token',token,'lease_until',statement_timestamp()+interval '5 minutes'));
  end loop;
  return rows;
end;
$function$;
alter function internal.claim_media_cleanup(integer) owner to postgres;
revoke all on function internal.claim_media_cleanup(integer) from public;
grant execute on function internal.claim_media_cleanup(integer) to service_role;

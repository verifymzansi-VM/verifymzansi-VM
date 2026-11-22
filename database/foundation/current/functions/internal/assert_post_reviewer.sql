-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_post_reviewer(p_actor uuid, p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if internal.current_verified_identity(p_actor) is null then
    raise exception 'ID verification required to review posts' using errcode = '42501',
      detail = 'staff_identity_required';
  end if;
  if internal.queue_conflict(p_actor, p_post_id, null) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
end;
$function$;
alter function internal.assert_post_reviewer(uuid,uuid) owner to postgres;
revoke all on function internal.assert_post_reviewer(uuid,uuid) from public;

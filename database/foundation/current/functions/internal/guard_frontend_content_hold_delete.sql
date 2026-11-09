-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.guard_frontend_content_hold_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if exists(select 1 from private.frontend_content_holds h where h.post_id=old.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode='PT423',detail='staff_visibility_hold';
  end if;
  return old;
end$function$;
alter function internal.guard_frontend_content_hold_delete() owner to postgres;
revoke all on function internal.guard_frontend_content_hold_delete() from public;
